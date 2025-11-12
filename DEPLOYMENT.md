# Deployment Guide

## Quick Start

1. **Install dependencies:**

```bash
npm install
cd app && npm install && cd ..
```

2. **Build the application:**

```bash
cd app
npm run build
cd ..
```

3. **Bootstrap CDK (first time only):**

```bash
cdk bootstrap
```

4. **Configure Athena:**

   - Update the Athena database, table, and workgroup names in `lib/bedrock-training-pipeline-stack.ts` (lines 180-182)
   - Ensure your Athena table has the required schema:
     - `title` (VARCHAR)
     - `content` (VARCHAR)
     - `publication_id` (VARCHAR)
     - `published_date` (DATE)
     - `metadata` (VARCHAR/JSON, optional)

5. **Deploy the stack:**

```bash
cdk deploy
```

## Configuration

### Stack Parameters

You can customize the stack by modifying `bin/app.ts`:

```typescript
new BedrockTrainingPipelineStack(app, "BedrockTrainingPipelineStack", {
  env: { account: "YOUR_ACCOUNT", region: "us-east-1" },
  minPromptCount: 100, // Minimum prompts required
  defaultLookBackDays: 30, // Default look-back period
  alertEmail: "your@email.com", // SNS alert email
});
```

### Environment Variables

The ECS task expects these environment variables (automatically set):

- `TRAINING_DATA_BUCKET`: S3 bucket name
- `MIN_PROMPT_COUNT`: Minimum prompts (default: 100)
- `DEFAULT_LOOK_BACK_DAYS`: Default look-back (default: 30)
- `AWS_REGION`: AWS region
- `ATHENA_DATABASE`: Athena database name
- `ATHENA_TABLE`: Athena table name
- `ATHENA_WORKGROUP`: Athena workgroup name

## Running the Pipeline

### Input Format

Start a Step Functions execution with this input:

```json
{
  "lookBackDays": 30,
  "publicationId": "publication-123"
}
```

### Via AWS Console

1. Navigate to Step Functions
2. Find the state machine (output after deployment)
3. Click "Start execution"
4. Paste the input JSON above

### Via AWS CLI

```bash
aws stepfunctions start-execution \
  --state-machine-arn <STATE_MACHINE_ARN> \
  --input '{"lookBackDays": 30, "publicationId": "publication-123"}'
```

## Outputs

After deployment, you'll see:

- `TrainingDataBucketName`: S3 bucket for datasets
- `StateMachineArn`: Step Functions ARN
- `AlertTopicArn`: SNS topic ARN

## Troubleshooting

### ECS Task Fails

- Check CloudWatch Logs: `/ecs/bedrock-training-pipeline`
- Verify Athena permissions in IAM role
- Check that Athena query succeeds manually

### Insufficient Prompts

- Increase `lookBackDays` in input
- Check Athena query returns data
- Verify data cleaning filters aren't too strict

### Lambda Can't Parse Output

- Check CloudWatch Logs for the ParseTaskOutput Lambda
- Verify ECS task completed successfully
- Check log group permissions

## Customization

### Modify Data Cleaning

Edit `app/src/data-cleaner.ts` to adjust:

- HTML stripping options
- Duplicate detection logic
- Validation rules

### Change Prompt Format

Edit `app/src/data-cleaner.ts` methods:

- `createPrompt()`: Adjust prompt structure
- `createCompletion()`: Adjust expected output

### Add Bedrock Training

Uncomment and configure the Bedrock service call in:

- `app/src/index.ts` (Step 6)
- Configure `BEDROCK_MODEL_ID` and `BEDROCK_BASE_MODEL_ARN`

## Security Notes

- IAM roles follow least-privilege
- S3 bucket encryption enabled
- VPC isolation for ECS tasks
- No hardcoded credentials
- All secrets via environment variables

## Cost Optimization

- ECS tasks run only when triggered
- Step Functions charges per state transition
- S3 lifecycle policies clean old versions
- Consider Fargate Spot for lower costs (can be configured)
