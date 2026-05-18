import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Cross-app secrets that should outlive any single workload deploy.
 *
 * Only the HMAC secret lives here for now. The RDS-generated credential
 * secret stays with the `DatabaseInstance` in `DataStack` — that secret's
 * lifecycle is bound to the database (recreate the DB, you recreate the
 * credentials), so it doesn't belong here.
 */
export class SecretsStack extends Stack {
  public readonly hmacSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.hmacSecret = new secretsmanager.Secret(this, 'HmacSecret', {
      secretName: 'yeet/bet-processor/hmac',
      description:
        'HMAC-SHA256 shared secret used by the bet processor to sign and verify the aggregator API.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
      },
      // MVP: tear down with the stack. In prod, switch to RETAIN so a
      // routine teardown of the workload can't accidentally lose the secret
      // (rotating it would break every signed request in flight).
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
