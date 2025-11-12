import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface BedrockTrainingPipelineStackProps extends cdk.StackProps {
  /**
   * Minimum number of prompts required for training
   * @default 100
   */
  minPromptCount?: number;

  /**
   * Default look-back period in days
   * @default 30
   */
  defaultLookBackDays?: number;

  /**
   * SNS topic email for alerts
   */
  alertEmail?: string;

  /**
   * Stage for the stack
   */
  stage: string;
}

export class BedrockTrainingPipelineStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: BedrockTrainingPipelineStackProps
  ) {
    super(scope, id, props);

    const minPromptCount = props.minPromptCount ?? 100;
    const defaultLookBackDays = props.defaultLookBackDays ?? 30;

    // S3 bucket for storing training datasets
    const trainingDataBucket = new s3.Bucket(this, "TrainingDataBucket", {
      bucketName: `bedrock-training-data-${props.stage}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "DeleteOldVersions",
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    });

    // SNS topic for alerts
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: `training-pipeline-alerts-${props.stage}`,
    });

    if (props.alertEmail) {
      alertTopic.addSubscription(new subs.EmailSubscription(props.alertEmail));
    }

    // ECS cluster (uses default VPC)
    const cluster = new ecs.Cluster(this, "TrainingCluster");

    // Task execution role
    const taskExecutionRole = new iam.Role(this, "TaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
      ],
    });

    // Task role with permissions for Athena, S3, Bedrock
    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Grant permissions to query Athena
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup",
        ],
        resources: ["*"],
      })
    );

    // Grant permissions to read/write S3
    trainingDataBucket.grantReadWrite(taskRole);

    // Grant permissions to access Bedrock
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:CreateModelCustomizationJob",
          "bedrock:GetModelCustomizationJob",
          "bedrock:ListModelCustomizationJobs",
          "bedrock:StopModelCustomizationJob",
          "bedrock:GetFoundationModel",
          "bedrock:ListFoundationModels",
        ],
        resources: ["*"],
      })
    );

    // Grant permissions to publish to SNS for alerts
    alertTopic.grantPublish(taskRole);

    // Grant permissions to access Glue (for Athena)
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"],
        resources: ["*"],
      })
    );

    // Grant permissions to access CloudWatch Logs
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      })
    );

    // Log group for ECS tasks
    const logGroup = new logs.LogGroup(this, "TaskLogGroup", {
      logGroupName: `/ecs/bedrock-training-pipeline/${props.stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TrainingTaskDefinition",
      {
        memoryLimitMiB: 4096,
        cpu: 2048,
        executionRole: taskExecutionRole,
        taskRole: taskRole,
      }
    );

    // Container definition
    const container = taskDefinition.addContainer("TrainingContainer", {
      image: ecs.ContainerImage.fromAsset("./app"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "training-pipeline",
        logGroup,
      }),
      environment: {
        TRAINING_DATA_BUCKET: trainingDataBucket.bucketName,
        MIN_PROMPT_COUNT: minPromptCount.toString(),
        DEFAULT_LOOK_BACK_DAYS: defaultLookBackDays.toString(),
        AWS_REGION: this.region,
        ATHENA_DATABASE: "default",
        ATHENA_TABLE: "articles",
        ATHENA_WORKGROUP: "primary",
        STAGE: props.stage,
      },
    });

    // Step Functions state machine
    const stateMachine = this.createStateMachine(
      cluster,
      taskDefinition,
      alertTopic,
      minPromptCount,
      trainingDataBucket,
      props.stage
    );

    // Outputs
    new cdk.CfnOutput(this, "TrainingDataBucketName", {
      value: trainingDataBucket.bucketName,
      description: "S3 bucket for storing training datasets",
    });

    new cdk.CfnOutput(this, "StateMachineArn", {
      value: stateMachine.stateMachineArn,
      description: "Step Functions state machine ARN",
    });

    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: alertTopic.topicArn,
      description: "SNS topic for training alerts",
    });
  }

  private createStateMachine(
    cluster: ecs.ICluster,
    taskDefinition: ecs.FargateTaskDefinition,
    alertTopic: sns.ITopic,
    minPromptCount: number,
    trainingDataBucket: s3.IBucket,
    stage: string
  ): stepfunctions.StateMachine {
    // Task to run ECS task
    const runTrainingTask = new tasks.EcsRunTask(this, "RunTrainingTask", {
      cluster,
      taskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget({
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }),
      assignPublicIp: true,
      integrationPattern: stepfunctions.IntegrationPattern.RUN_JOB,
      containerOverrides: [
        {
          containerDefinition: taskDefinition.defaultContainer!,
          environment: [
            {
              name: "LOOK_BACK_DAYS",
              value: stepfunctions.JsonPath.format(
                "{}",
                stepfunctions.JsonPath.stringAt("$.lookBackDays")
              ),
            },
            {
              name: "PUBLICATION_ID",
              value: stepfunctions.JsonPath.format(
                "{}",
                stepfunctions.JsonPath.stringAt("$.publicationId")
              ),
            },
            {
              name: "TRAINING_RUN_ID",
              value: stepfunctions.JsonPath.stringAt("$$.Execution.Name"),
            },
            {
              name: "ATHENA_OUTPUT_LOCATION",
              value: `s3://${trainingDataBucket.bucketName}/athena-results/`,
            },
            {
              name: "ALERT_TOPIC_ARN",
              value: alertTopic.topicArn,
            },
            {
              name: "MIN_PROMPT_COUNT",
              value: minPromptCount.toString(),
            },
            {
              name: "STAGE",
              value: stage,
            },
          ],
        },
      ],
      resultPath: "$.taskExecution",
    });

    // Step 1: Wait for a few minutes before checking the training job status
    const waitForTraining = new stepfunctions.Wait(this, "WaitForTraining", {
      time: stepfunctions.WaitTime.duration(cdk.Duration.minutes(5)),
    });

    // Step 2: Check the status of the Bedrock training job
    const checkTrainingStatus = new tasks.CallAwsService(
      this,
      "CheckTrainingStatus",
      {
        service: "bedrock",
        action: "getModelCustomizationJob",
        parameters: {
          JobIdentifier: stepfunctions.JsonPath.stringAt(
            "$.taskExecution.BedrockJobArn"
          ), // Corrected key
        },
        iamResources: ["*"], // Allow Bedrock access (can be scoped further)
        resultPath: "$.trainingStatus",
      }
    );

    // Step 3: Handle training completion or failure
    const notifyFailure = new tasks.SnsPublish(this, "NotifyFailure", {
      topic: alertTopic,
      message: stepfunctions.TaskInput.fromObject({
        default: "Bedrock training job failed.",
        reason: stepfunctions.JsonPath.stringAt(
          "$.trainingStatus.failureReason"
        ),
      }),
      subject: "Bedrock Training Job Failure",
    });

    const handleTrainingCompletion = new stepfunctions.Choice(
      this,
      "HandleTrainingCompletion"
    )
      .when(
        stepfunctions.Condition.stringEquals(
          "$.trainingStatus.status",
          "COMPLETED"
        ),
        new stepfunctions.Succeed(this, "TrainingSucceeded")
      )
      .when(
        stepfunctions.Condition.stringEquals(
          "$.trainingStatus.status",
          "FAILED"
        ),
        notifyFailure.next(
          new stepfunctions.Fail(this, "TrainingFailed", {
            cause: "Bedrock training job failed",
            error: stepfunctions.JsonPath.stringAt(
              "$.trainingStatus.failureReason"
            ),
          })
        )
      )
      .otherwise(waitForTraining); // Keep waiting if the job is still in progress

    // Define the Bedrock training monitoring workflow
    const trainBedrockModel = waitForTraining
      .next(checkTrainingStatus)
      .next(handleTrainingCompletion);

    // Notify failure if the ECS task fails
    const notifyEcsFailure = new tasks.SnsPublish(this, "NotifyEcsFailure", {
      topic: alertTopic,
      message: stepfunctions.TaskInput.fromObject({
        default: "ECS task failed during training pipeline execution.",
        error: "The ECS task encountered an error or failed validation.",
      }),
      subject: "ECS Task Failure",
    });

    // Check if ECS task succeeded
    const checkTaskSuccess = new stepfunctions.Choice(this, "CheckTaskSuccess")
      .when(
        stepfunctions.Condition.booleanEquals(
          "$.taskExecution.Succeeded",
          true
        ),
        new stepfunctions.Pass(this, "TaskSucceeded", {
          result: stepfunctions.Result.fromObject({ status: "SUCCESS" }),
          resultPath: "$.validation",
        }).next(trainBedrockModel)
      )
      .otherwise(
        notifyEcsFailure.next(
          new stepfunctions.Fail(this, "TaskFailed", {
            cause: "ECS task failed - check CloudWatch logs for details",
            error:
              "The training task encountered an error or failed validation",
          })
        )
      );

    // Define the state machine
    const definition = runTrainingTask.next(checkTaskSuccess);

    const stateMachine = new stepfunctions.StateMachine(
      this,
      "TrainingPipelineStateMachine",
      {
        definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
        timeout: cdk.Duration.hours(4),
        logs: {
          destination: new logs.LogGroup(this, "StateMachineLogGroup", {
            logGroupName: `/aws/stepfunctions/bedrock-training-pipeline/${stage}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      }
    );

    // Grant Step Functions permissions to run ECS tasks
    stateMachine.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ecs:RunTask"],
        resources: [taskDefinition.taskDefinitionArn],
      })
    );

    stateMachine.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: [
          taskDefinition.taskRole.roleArn,
          taskDefinition.executionRole?.roleArn || "",
        ],
      })
    );

    // Grant Step Functions permissions to publish to SNS (if needed for error handling)
    // Note: The ECS task sends alerts directly via its IAM role

    return stateMachine;
  }
}
