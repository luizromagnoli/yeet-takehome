import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * App-level secrets that own their lifecycle independently of compute and
 * data. Both secrets are CDK-named (no fixed `secretName`) so multiple
 * deploys can coexist (e.g. preview environments) without colliding on a
 * hard-coded ARN suffix.
 *
 * - `hmacSecret` — HMAC-SHA256 shared secret used by the bet processor to
 *   sign and verify the aggregator API.
 * - `dbCredentialsSecret` — RDS master credentials. Lives here, not in
 *   DataStack, because the password is purely an app-side concern: the DB
 *   doesn't care what value the password takes, and managing it here means
 *   `cdk destroy Yeet-Data` doesn't drop the credentials (a re-deploy of
 *   the DB stack against the existing data volume could continue using the
 *   same password).
 */
export class SecretsStack extends Stack {
  public readonly hmacSecret: secretsmanager.Secret;
  public readonly dbCredentialsSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.hmacSecret = new secretsmanager.Secret(this, 'HmacSecret', {
      description:
        'HMAC-SHA256 shared secret used by the bet processor to sign and verify the aggregator API.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // JSON-shaped secret: { "username": "yeet_admin", "password": "<generated>" }.
    // `rds.Credentials.fromSecret(...)` in DataStack consumes both fields; the
    // ECS task reads them as separate env vars via `ecs.Secret.fromSecretsManager`
    // with the field name.
    this.dbCredentialsSecret = new secretsmanager.Secret(this, 'DbCredentials', {
      description:
        'RDS master credentials for the bet-processor database (username + password).',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'yeet_admin' }),
        generateStringKey: 'password',
        passwordLength: 32,
        excludePunctuation: true,
        includeSpace: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
