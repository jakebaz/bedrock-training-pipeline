import { DataService } from "./data-service";
import { DataCleaner } from "./data-cleaner";
import { StorageService } from "./storage-service";
import { BedrockService } from "./bedrock-service";
import { DistillationService } from "./distillation-service";
import { TrainingConfig } from "./types";

async function main() {
  const region = process.env.AWS_REGION || "eu-west-1";
  const trainingDataBucket = process.env.TRAINING_DATA_BUCKET;
  const minPromptCount = parseInt(process.env.MIN_PROMPT_COUNT || "100", 10);
  const defaultLookBackDays = parseInt(
    process.env.DEFAULT_LOOK_BACK_DAYS || "30",
    10
  );
  const lookBackDays = parseInt(
    process.env.LOOK_BACK_DAYS || defaultLookBackDays.toString(),
    10
  );
  const trainingRunId = process.env.TRAINING_RUN_ID || `run-${Date.now()}`;
  const publicationId = process.env.PUBLICATION_ID;

  // Athena configuration - adjust these based on your setup
  const athenaDatabase = process.env.ATHENA_DATABASE || "default";
  const athenaTable = process.env.ATHENA_TABLE || "articles";
  const athenaWorkgroup = process.env.ATHENA_WORKGROUP || "primary";
  const athenaOutputLocation =
    process.env.ATHENA_OUTPUT_LOCATION ||
    `s3://${trainingDataBucket}/athena-results/`;

  if (!trainingDataBucket) {
    throw new Error("TRAINING_DATA_BUCKET environment variable is required");
  }

  const config: TrainingConfig = {
    lookBackDays,
    publicationId,
    trainingRunId,
    minPromptCount,
    trainingDataBucket,
    athenaDatabase,
    athenaTable,
    athenaWorkgroup,
    athenaOutputLocation,
  };

  console.log("Starting training pipeline with config:", {
    ...config,
    trainingDataBucket: "[REDACTED]",
  });

  try {
    // Step 1: Query data from Athena
    console.log("Step 1: Querying data from Athena...");
    const dataService = new DataService(region);
    const rawExamples = await dataService.queryTrainingData(config);
    console.log(`Retrieved ${rawExamples.length} raw examples`);

    if (rawExamples.length < minPromptCount) {
      throw new Error(
        `Insufficient examples: ${rawExamples.length} found, ${minPromptCount} required`
      );
    }

    // Step 2: Clean and validate data
    console.log("Step 2: Cleaning and validating data...");
    const dataCleaner = new DataCleaner();
    const cleanedExamples = dataCleaner.cleanExamples(rawExamples);
    console.log(`After cleaning: ${cleanedExamples.length} examples`);

    if (cleanedExamples.length < minPromptCount) {
      throw new Error(
        `Insufficient examples after cleaning: ${cleanedExamples.length} found, ${minPromptCount} required`
      );
    }

    // Step 3: Use teacher model for distillation
    console.log("Step 3: Generating teacher model outputs (distillation)...");
    const teacherModelId =
      process.env.TEACHER_MODEL_ID ||
      "anthropic.claude-3-5-sonnet-20241022-v2:0";
    const distillationService = new DistillationService({
      teacherModelId,
      region,
      maxConcurrentRequests: 5,
    });
    const prompts = await distillationService.distillExamples(cleanedExamples);
    console.log(`Created ${prompts.length} distillation prompts`);

    // Step 4: Validate minimum prompt count
    if (prompts.length < minPromptCount) {
      const error = `Insufficient prompts: ${prompts.length} found, ${minPromptCount} required`;
      console.error(error);

      process.exit(1);
    }

    // Step 5: Save to S3
    console.log("Step 5: Saving training dataset to S3...");
    const storageService = new StorageService(region);
    const result = await storageService.saveTrainingDataset(prompts, config);

    // Step 6: Initiate Bedrock training
    console.log("Step 6: Initiating Bedrock model training...");
    const bedrockService = new BedrockService(region);
    const bedrockConfig = {
      modelId: process.env.BEDROCK_MODEL_ID || "anthropic.claude-v2",
      trainingDataS3Uri: result.s3Location,
      outputDataConfigS3Uri: `s3://${trainingDataBucket}/bedrock-outputs/${config.trainingRunId}/`,
      baseModelArn: process.env.BEDROCK_BASE_MODEL_ARN || "",
    };

    try {
      const jobArn = await bedrockService.createModelCustomizationJob(
        config,
        result,
        bedrockConfig
      );
      console.log(`Bedrock training job started: ${jobArn}`);
    } catch (error) {
      console.error(
        "Failed to start Bedrock training job (dataset is saved in S3):",
        error
      );
      throw error;
    }

    console.log("Training pipeline completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Training pipeline failed:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
