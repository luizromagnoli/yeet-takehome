import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * VPC + VPC endpoints. Foundational, rarely changes.
 *
 * Topology choices that drive the rest of the stack family:
 *   - `natGateways: 0` — no outbound internet from the workload subnets.
 *     ECS tasks reach AWS APIs (ECR, Secrets Manager, CloudWatch Logs) via
 *     interface endpoints instead. Trades ~$30/mo of endpoint cost for
 *     ~$32/mo of NAT cost and a tighter network posture.
 *   - `maxAzs: 2` — ALB requires at least two AZs of public subnets. We
 *     still run a single ECS task and a single RDS instance, so the second
 *     AZ exists only for ALB placement.
 */
export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/20'),
      maxAzs: 2,
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // One SG for all interface endpoints. We allow ingress from the VPC CIDR
    // rather than peering with the ServiceStack's task SG — peering would
    // create a circular reference between NetworkStack and ServiceStack
    // (network exports the SG, service imports it; service exports its own
    // SG, network would import it back). VPC-CIDR ingress is functionally
    // equivalent because nothing else lives in this CIDR.
    const endpointsSg = new ec2.SecurityGroup(this, 'EndpointsSg', {
      vpc: this.vpc,
      description: 'Ingress to VPC interface endpoints from inside the VPC',
      allowAllOutbound: true,
    });
    endpointsSg.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'HTTPS from anything inside the VPC',
    );

    const interfaceServices: ec2.InterfaceVpcEndpointAwsService[] = [
      ec2.InterfaceVpcEndpointAwsService.ECR,
      ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    ];
    for (const service of interfaceServices) {
      this.vpc.addInterfaceEndpoint(`Endpoint-${service.shortName}`, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [endpointsSg],
        privateDnsEnabled: true,
      });
    }

    // S3 gateway endpoint is free and required because ECR layers are
    // served out of S3 — without it, image pulls would silently fall back
    // to the public ECR S3 endpoint, which is unreachable without NAT.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });
  }
}
