import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PromptExample, TrainingConfig, ProcessingResult } from "./types";

export class StorageService {
  private s3Client: S3Client;

  constructor(region: string) {
    this.s3Client = new S3Client({ region });
  }

  async saveTrainingDataset(
    prompts: PromptExample[],
    config: TrainingConfig
  ): Promise<ProcessingResult> {
    const datasetVersion = `${Date.now()}-${config.trainingRunId}`;
    const key = `datasets/${
      config.publicationId || "all"
    }/${datasetVersion}/training-data.jsonl`;

    // Convert prompts to JSONL format
    const jsonlContent = prompts
      .map((prompt) => JSON.stringify(prompt))
      .join("\n");

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: config.trainingDataBucket,
      Key: key,
      Body: jsonlContent,
      ContentType: "application/jsonl",
      Metadata: {
        "training-run-id": config.trainingRunId,
        "prompt-count": prompts.length.toString(),
        "publication-id": config.publicationId || "all",
        "look-back-days": config.lookBackDays.toString(),
      },
    });

    await this.s3Client.send(command);

    const s3Location = `s3://${config.trainingDataBucket}/${key}`;

    console.log(`Saved ${prompts.length} prompts to ${s3Location}`);

    return {
      promptCount: prompts.length,
      s3Location,
      datasetVersion,
      processingTime: Date.now(),
    };
  }
}
