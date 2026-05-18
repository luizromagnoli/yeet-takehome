import * as path from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ServiceStackProps extends StackProps {
  readonly vpc: ec2.IVpc;
  readonly dbInstance: rds.DatabaseInstance;
  readonly hmacSecret: secretsmanager.ISecret;
}

/**
 * ECS Fargate service + ALB. Volatile — every app deploy lands here.
 *
 * Image source is context-flag controlled:
 *   - default (`useLocalAsset=true`): `ContainerImage.fromAsset` against
 *     the repo's Dockerfile. Honest source-of-truth wiring for an actual
 *     deploy — requires Docker available at synth time.
 *   - `-c useLocalAsset=false`: a public registry image stand-in so a
 *     reviewer can synth this stack on a clean machine without Docker.
 */
export class ServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    const logGroup = new logs.LogGroup(this, 'TaskLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const image = this.resolveContainerImage();

    taskDef.addContainer('api', {
      image,
      essential: true,
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      logging: ecs.LogDriver.awsLogs({ streamPrefix: 'api', logGroup }),
      environment: {
        PORT: '3000',
        MIGRATE_ON_BOOT: 'true',
        PARTITIONS_MONTHS_AHEAD: '3',
        ACTION_IDEMPOTENCY_RETENTION_DAYS: '90',
        NODE_ENV: 'production',
        DB_HOST: props.dbInstance.dbInstanceEndpointAddress,
        DB_PORT: props.dbInstance.dbInstanceEndpointPort,
        DB_NAME: 'yeet',
      },
      secrets: {
        BET_PROCESSOR_HMAC_SECRET: ecs.Secret.fromSecretsManager(
          props.hmacSecret,
        ),
        DB_USER: ecs.Secret.fromSecretsManager(
          props.dbInstance.secret!,
          'username',
        ),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(
          props.dbInstance.secret!,
          'password',
        ),
      },
    });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: props.vpc,
      description: 'Public ingress to the ALB on 80',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc: props.vpc,
      description: 'Task ingress from the ALB on 3000',
      allowAllOutbound: true,
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [serviceSg],
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    // The DB SG (in DataStack) already accepts 5432 from the VPC CIDR — the
    // same pattern the endpoints SG uses to avoid a cross-stack ingress
    // rule that would point back at the service SG. Peer-SG references
    // here would create a Data → Service edge against the existing
    // Service → Data edge and form a cycle.

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSg,
    });

    const listener = alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // SG already opened to 0.0.0.0/0; avoid CDK re-adding it
    });

    listener.addTargets('Api', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: 'api', containerPort: 3000 })],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
      },
      deregistrationDelay: Duration.seconds(10),
    });

    // Allow ALB → task on the container port. The service SG only accepts
    // traffic from the ALB SG; `serviceSg.addIngressRule(albSg, …)` would
    // do the same, but `service.connections.allowFrom(alb, …)` is the
    // idiomatic helper.
    service.connections.allowFrom(
      alb,
      ec2.Port.tcp(3000),
      'ALB to task on container port',
    );

    new CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'Public DNS name of the ALB (HTTP only — MVP).',
    });
  }

  private resolveContainerImage(): ecs.ContainerImage {
    // Context value comes from cdk.json or `-c useLocalAsset=...` on the CLI.
    // tryGetContext returns the raw value (string in cdk.json) — treat
    // anything other than the literal string 'false' as "use the local
    // Dockerfile asset". This keeps the default behavior `fromAsset` while
    // letting reviewers synth without Docker via `-c useLocalAsset=false`.
    const useLocalAsset = this.node.tryGetContext('useLocalAsset') !== 'false';
    if (useLocalAsset) {
      return ecs.ContainerImage.fromAsset(
        path.resolve(__dirname, '..', '..'),
        { file: 'Dockerfile' },
      );
    }
    return ecs.ContainerImage.fromRegistry(
      'public.ecr.aws/docker/library/node:24-alpine',
    );
  }
}
