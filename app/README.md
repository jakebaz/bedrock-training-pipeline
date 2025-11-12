# Bedrock Training Application

This is the ECS task application that processes training data and prepares it for Bedrock model training.

## Building

```bash
npm install
npm run build
```

## Running Locally

Set environment variables:

```bash
export TRAINING_DATA_BUCKET=your-bucket-name
export MIN_PROMPT_COUNT=100
export DEFAULT_LOOK_BACK_DAYS=30
export AWS_REGION=us-east-1
export ATHENA_DATABASE=default
export ATHENA_TABLE=articles
export ATHENA_WORKGROUP=primary
export ATHENA_OUTPUT_LOCATION=s3://your-bucket/athena-results/
export LOOK_BACK_DAYS=30
export TRAINING_RUN_ID=test-run-123
```

Then run:

```bash
npm start
```

## Docker Build

```bash
docker build -t bedrock-training-app .
docker run -e TRAINING_DATA_BUCKET=... -e AWS_REGION=... bedrock-training-app
```

## Data Flow

1. Queries Athena for human-authored content
2. Cleans data (null removal, HTML stripping, duplicate filtering)
3. Validates data (entity/quote checks)
4. Transforms to prompt format
5. Validates minimum prompt count
6. Saves to S3 in JSONL format
7. (Optional) Initiates Bedrock training job

## Output Format

The application outputs JSON to stdout:

```json
{
  "promptCount": 150,
  "s3Location": "s3://bucket/datasets/all/1234567890-run-123/training-data.jsonl",
  "datasetVersion": "1234567890-run-123",
  "processingTime": 1234567890
}
```

This output is consumed by Step Functions for validation and downstream processing.
