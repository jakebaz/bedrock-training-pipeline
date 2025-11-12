import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TrainingExample, PromptExample } from "./types";

export interface DistillationConfig {
  teacherModelId: string;
  region: string;
  maxConcurrentRequests?: number;
}

export class DistillationService {
  private bedrockClient: BedrockRuntimeClient;
  private teacherModelId: string;
  private maxConcurrentRequests: number;

  constructor(config: DistillationConfig) {
    this.bedrockClient = new BedrockRuntimeClient({ region: config.region });
    this.teacherModelId = config.teacherModelId;
    this.maxConcurrentRequests = config.maxConcurrentRequests || 5;
  }

  /**
   * Use teacher model to generate high-quality outputs for distillation
   * This creates training data where a powerful teacher model generates
   * the "completion" that a smaller student model will learn from
   */
  async distillExamples(examples: TrainingExample[]): Promise<PromptExample[]> {
    console.log(
      `Starting distillation with teacher model: ${this.teacherModelId}`
    );
    console.log(`Processing ${examples.length} examples...`);

    const prompts: PromptExample[] = [];

    // Process in batches to avoid rate limits
    for (let i = 0; i < examples.length; i += this.maxConcurrentRequests) {
      const batch = examples.slice(i, i + this.maxConcurrentRequests);
      const batchPromises = batch.map((example) =>
        this.generateTeacherOutput(example)
      );

      const batchResults = await Promise.all(batchPromises);
      prompts.push(...batchResults);

      console.log(
        `Processed ${Math.min(
          i + this.maxConcurrentRequests,
          examples.length
        )}/${examples.length} examples`
      );
    }

    console.log(`Distillation complete: ${prompts.length} prompts generated`);
    return prompts;
  }

  /**
   * Generate output from teacher model for a single example
   */
  private async generateTeacherOutput(
    example: TrainingExample
  ): Promise<PromptExample> {
    const prompt = this.createDistillationPrompt(example);

    try {
      // Invoke teacher model to generate headline
      const command = new InvokeModelCommand({
        modelId: this.teacherModelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      // Extract the generated completion from teacher model
      const teacherCompletion =
        responseBody.content?.[0]?.text?.trim() || example.title;

      return {
        prompt: this.createStudentPrompt(example),
        completion: teacherCompletion, // Use teacher's output as the target
        metadata: {
          articleId: example.articleId,
          publication: example.publication,
          publishedDate: example.publishedDate,
          originalTitle: example.title, // Keep original for reference
          teacherModel: this.teacherModelId,
          ...example.metadata,
        },
      };
    } catch (error) {
      console.error(
        `Error generating teacher output for article ${example.articleId}:`,
        error
      );
      // Fallback to original title if teacher model fails
      return {
        prompt: this.createStudentPrompt(example),
        completion: example.title,
        metadata: {
          articleId: example.articleId,
          publication: example.publication,
          publishedDate: example.publishedDate,
          teacherModelError:
            error instanceof Error ? error.message : String(error),
          ...example.metadata,
        },
      };
    }
  }

  /**
   * Create prompt for teacher model to generate high-quality output
   */
  private createDistillationPrompt(example: TrainingExample): string {
    return `You are an expert headline writer for ${example.publication}. 
      Generate a high-quality, SEO-optimized headline for the following article content. The headline should be:
      - Editorial quality and engaging
      - SEO-optimized with relevant keywords
      - Appropriate for the publication's style
      - Between 8-15 words

      Article content:
      ${example.content.substring(0, 1000)}${
      example.content.length > 1000 ? "..." : ""
    }

      Generate the headline:`;
  }

  /**
   * Create prompt format for student model training
   * This is what the smaller student model will see during training
   */
  private createStudentPrompt(example: TrainingExample): string {
    return `Generate a headline for the following article:

Article content:
${example.content.substring(0, 500)}${example.content.length > 500 ? "..." : ""}

Publication: ${example.publication}
Style requirements: Editorial quality, SEO-optimized, engaging`;
  }
}
