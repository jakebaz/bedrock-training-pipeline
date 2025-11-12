#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BedrockTrainingPipelineStack } from "../lib/bedrock-training-pipeline-stack";

const app = new cdk.App();

new BedrockTrainingPipelineStack(app, "BedrockTrainingPipelineStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-west-1",
  },
  stage: "dev",
  description:
    "AI Model Training Pipeline using AWS Bedrock, Step Functions, and ECS",
});

app.synth();
