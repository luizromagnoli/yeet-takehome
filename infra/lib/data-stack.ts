import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  readonly vpc: ec2.IVpc;
}

/**
 * RDS PostgreSQL 16 + its managed credential secret.
 *
 * Persistent state. Updates here (engine version, instance class, storage)
 * happen rarely and on a different cadence from app deploys. Living in a
 * separate stack means a routine ServiceStack churn can never accidentally
 * destroy the database.
 */
export class DataStack extends Stack {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Dedicated SG so cross-stack ingress rules attach to a stable resource.
    // CDK's `db.connections.allowDefaultPortFrom(service)` from ServiceStack
    // emits the rule against this SG via cross-stack export of the SG ID.
    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'Ingress to RDS on 5432 from inside the VPC',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Postgres from anything inside the VPC',
    );

    this.dbInstance = new rds.DatabaseInstance(this, 'Postgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret('yeet_admin', {
        secretName: 'yeet/bet-processor/db',
      }),
      databaseName: 'yeet',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(1),
      deleteAutomatedBackups: true,
      // MVP: easy teardown. Flip to true + RemovalPolicy.RETAIN before any
      // production traffic.
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      // pgcrypto is the only extension the app needs; the migrations issue
      // `CREATE EXTENSION IF NOT EXISTS pgcrypto` at first run. No custom
      // parameter group needed for that.
    });
  }
}
