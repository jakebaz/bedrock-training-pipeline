import { convert } from "html-to-text";
import { TrainingExample, PromptExample } from "./types";

export class DataCleaner {
  private seenArticleIds: Set<string> = new Set();

  /**
   * Clean and validate training examples
   */
  cleanExamples(examples: TrainingExample[]): TrainingExample[] {
    console.log(`Starting cleaning process for ${examples.length} examples`);

    // Step 1: Remove null/empty values
    let cleaned = this.removeNulls(examples);
    console.log(`After null removal: ${cleaned.length} examples`);

    // Step 2: Strip HTML
    cleaned = this.stripHtml(cleaned);
    console.log(`After HTML stripping: ${cleaned.length} examples`);

    // Step 3: Filter duplicates
    cleaned = this.filterDuplicates(cleaned);
    console.log(`After duplicate filtering: ${cleaned.length} examples`);

    // Step 4: Validate entities and quotes
    cleaned = this.validateEntitiesAndQuotes(cleaned);
    console.log(`After entity/quote validation: ${cleaned.length} examples`);

    return cleaned;
  }

  /**
   * Remove examples with null or empty values
   */
  private removeNulls(examples: TrainingExample[]): TrainingExample[] {
    return examples.filter(
      (example) =>
        example.articleId &&
        example.title &&
        example.content &&
        example.title.trim() !== "" &&
        example.content.trim() !== "" &&
        example.publication &&
        example.publishedDate
    );
  }

  /**
   * Strip HTML markup from content
   */
  private stripHtml(examples: TrainingExample[]): TrainingExample[] {
    const htmlToTextOptions = {
      wordwrap: null,
      preserveNewlines: true,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    };

    return examples.map((example) => ({
      ...example,
      title: convert(example.title, htmlToTextOptions).trim(),
      content: convert(example.content, htmlToTextOptions).trim(),
    }));
  }

  /**
   * Filter duplicate examples based on article ID
   */
  private filterDuplicates(examples: TrainingExample[]): TrainingExample[] {
    this.seenArticleIds.clear();
    const unique: TrainingExample[] = [];

    for (const example of examples) {
      if (!this.seenArticleIds.has(example.articleId)) {
        this.seenArticleIds.add(example.articleId);
        unique.push(example);
      }
    }

    return unique;
  }

  /**
   * Validate entities and quotes for factual consistency
   */
  private validateEntitiesAndQuotes(
    examples: TrainingExample[]
  ): TrainingExample[] {
    return examples.filter((example) => {
      // Basic validation: check for balanced quotes
      const quoteCount =
        (example.title.match(/"/g) || []).length +
        (example.content.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        console.warn(
          `Unbalanced quotes detected in example: ${example.title.substring(
            0,
            50
          )}`
        );
        // You can choose to exclude or include - for now we'll include but log
      }

      // Check for minimum content length
      if (example.content.length < 50 || example.title.length < 5) {
        return false;
      }

      // Check for suspicious patterns (all caps, too many special chars, etc.)
      const allCapsRatio =
        (example.title.match(/[A-Z]/g) || []).length / example.title.length;
      if (allCapsRatio > 0.8 && example.title.length > 20) {
        return false; // Likely a spam/noise entry
      }

      return true;
    });
  }

  /**
   * Transform cleaned examples into prompt format for training
   */
  transformToPrompts(examples: TrainingExample[]): PromptExample[] {
    return examples.map((example, index) => {
      // Create a structured prompt based on the journalism use case
      // Adjust this format based on your specific needs
      const prompt = this.createPrompt(example);
      const completion = this.createCompletion(example);

      return {
        prompt,
        completion,
        metadata: {
          articleId: example.articleId,
          publication: example.publication,
          publishedDate: example.publishedDate,
          exampleIndex: index,
          ...example.metadata,
        },
      };
    });
  }

  private createPrompt(example: TrainingExample): string {
    // Format: Instructions + context
    return `Generate a headline for the following article:

Article content:
${example.content.substring(0, 500)}...

Publication: ${example.publication}
Style requirements: Editorial quality, SEO-optimized, engaging`;
  }

  private createCompletion(example: TrainingExample): string {
    // The expected output (the actual headline)
    return example.title;
  }
}
