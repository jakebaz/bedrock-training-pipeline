# AWS Bedrock Training Pipeline

This project provides a complete CDK infrastructure and application code for building a flexible AI model training pipeline on AWS Bedrock, using Step Functions, ECS, Athena, and S3.

## Architecture

- **Step Functions**: Orchestrates the training workflow
- **ECS (Fargate)**: Runs the data processing task
- **Amazon Athena**: Queries human-authored training data
- **Amazon S3**: Stores training datasets in JSONL format
- **Amazon SNS**: Sends alerts for validation failures
- **Amazon Bedrock**: Performs model distillation/training

## Prerequisites

- AWS CLI configured
- Node.js 20+ installed
- Docker installed (for building ECS container)
- AWS CDK CLI installed: `npm install -g aws-cdk`

## Setup

1. Install dependencies:

```bash
npm install
cd app && npm install && cd ..
```

2. Build the application:

```bash
cd app
npm run build
cd ..
```

3. Configure your environment variables:

   - Set up your Athena database and table
   - Configure Athena workgroup and output location
   - Set up SNS alert email (optional)

4. Deploy the CDK stack:

```bash
cdk synth
cdk deploy
```

## Configuration

Update the stack configuration in `lib/bedrock-training-pipeline-stack.ts`:

- `minPromptCount`: Minimum number of prompts required (default: 100)
- `defaultLookBackDays`: Default look-back period in days (default: 30)
- `alertEmail`: Email address for SNS alerts

## ECS Task Environment Variables

The ECS task requires the following environment variables (automatically set by CDK):

- `TRAINING_DATA_BUCKET`: S3 bucket for training data
- `MIN_PROMPT_COUNT`: Minimum prompts required
- `DEFAULT_LOOK_BACK_DAYS`: Default look-back period
- `AWS_REGION`: AWS region

Optional (passed via Step Functions input):

- `LOOK_BACK_DAYS`: Custom look-back period
- `PUBLICATION_ID`: Filter by specific publication
- `TRAINING_RUN_ID`: Unique identifier for the run

## Athena Configuration

You'll need to set up your Athena database and table structure. The application expects a table with the following columns:

- `title`: Article headline
- `content`: Article content
- `publication_id`: Publication identifier
- `published_date`: Publication date (DATE type)
- `metadata`: Optional JSON metadata

Adjust the SQL query in `app/src/data-service.ts` to match your schema.

## Running the Pipeline

### Via Step Functions Console

1. Navigate to Step Functions in AWS Console
2. Find the state machine (output after CDK deploy)
3. Start a new execution with input:

```json
{
  "lookBackDays": 30,
  "publicationId": "publication-123"
}
```

### Via AWS CLI

```bash
aws stepfunctions start-execution \
  --state-machine-arn <STATE_MACHINE_ARN> \
  --input '{"lookBackDays": 30, "publicationId": "publication-123"}'
```

### Scheduled Execution

Add an EventBridge rule to trigger the Step Functions state machine on a schedule.

## Output

The pipeline outputs:

- Training dataset in JSONL format stored in S3
- Dataset version for traceability
- Prompt count validation
- Alerts via SNS if validation fails

## Data Processing

The ECS task performs:

1. **Data Gathering**: Queries Athena for human-authored examples
2. **Null Removal**: Filters incomplete records
3. **HTML Stripping**: Removes markup from text
4. **Duplicate Filtering**: Prevents over-representation
5. **Entity/Quote Validation**: Checks factual consistency
6. **Prompt Transformation**: Converts examples to training format
7. **S3 Storage**: Saves dataset in JSONL format

## Bedrock Integration

The Bedrock training step is included as a placeholder. Uncomment and configure the Bedrock service call in `app/src/index.ts` when ready to initiate model training.

## Customization

### Custom Prompt Format

Edit `app/src/data-cleaner.ts` to adjust the prompt format for your use case.

### Additional Validation

Extend `DataCleaner.validateEntitiesAndQuotes()` with your custom validation logic.

### Different Data Sources

Modify `DataService.queryTrainingData()` to query from different sources (not just Athena).

## Cost Optimization

- ECS tasks use Fargate Spot for cost savings (can be configured)
- S3 lifecycle policies automatically delete old versions
- Step Functions has low cost for orchestration

## Security

- IAM roles follow least-privilege principle
- S3 bucket encryption enabled
- VPC isolation for ECS tasks
- No hardcoded credentials

## Troubleshooting

### ECS Task Fails

- Check CloudWatch Logs: `/ecs/bedrock-training-pipeline`
- Verify Athena permissions
- Check S3 bucket access

### Insufficient Prompts

- Adjust `lookBackDays` to increase time window
- Check Athena query results
- Verify data cleaning filters aren't too strict

### Step Functions Timeout

- Increase timeout in stack definition
- Check ECS task resource allocation

## License

MIT
# bedrock-training-pipeline
