#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { NetworkStack } from '../lib/network-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { ServiceStack } from '../lib/service-stack';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const network = new NetworkStack(app, 'Yeet-Network', { env });
const secrets = new SecretsStack(app, 'Yeet-Secrets', { env });
const data = new DataStack(app, 'Yeet-Data', {
  env,
  vpc: network.vpc,
  credentialsSecret: secrets.dbCredentialsSecret,
});
const service = new ServiceStack(app, 'Yeet-Service', {
  env,
  vpc: network.vpc,
  dbInstance: data.dbInstance,
  hmacSecret: secrets.hmacSecret,
  dbCredentialsSecret: secrets.dbCredentialsSecret,
});

// Explicit dependency edges. CDK already infers most of these from the
// cross-stack references, but spelling them out makes `cdk deploy --all`
// ordering robust against future refactors that might temporarily drop a
// reference.
data.addDependency(network);
data.addDependency(secrets);
service.addDependency(network);
service.addDependency(data);
service.addDependency(secrets);
