import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DataStackProps extends StackProps {
  readonly vpc: ec2.IVpc;
  /** Username + password secret created in SecretsStack. */
  readonly credentialsSecret: secretsmanager.ISecret;
}

/**
 * RDS PostgreSQL 16. Persistent state, updated rarely (engine version,
 * instance class, storage), and on a different cadence from app deploys.
 *
 * Credentials are owned by `SecretsStack` and passed in — keeps the password
 * decoupled from the DB lifecycle so a `cdk destroy Yeet-Data` (or an
 * accidental engine-version replace that recreates the instance) doesn't
 * also drop the credentials.
 */
export class DataStack extends Stack {
  public readonly dbInstance: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

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
      // `Credentials.fromSecret(...)` would auto-create a SecretTargetAttachment
      // in the SECRET's stack pointing back at this DB — i.e. a
      // Yeet-Secrets → Yeet-Data reference against the existing
      // Yeet-Data → Yeet-Secrets edge. Cycle. `fromPassword` skips the
      // attachment (no managed rotation wiring) and reads the password
      // directly from the secret JSON. Rotation, if/when added, would be
      // routed through an RDS Proxy or a custom Lambda — out of MVP scope.
      credentials: rds.Credentials.fromPassword(
        'yeet_admin',
        props.credentialsSecret.secretValueFromJson('password'),
      ),
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
      removalPolicy: RemovalPolicy.RETAIN,
      // pgcrypto is the only extension the app needs; the migrations issue
      // `CREATE EXTENSION IF NOT EXISTS pgcrypto` at first run. No custom
      // parameter group needed for that.
    });
  }
}
