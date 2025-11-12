import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
} from "@aws-sdk/client-athena";
import { TrainingExample, TrainingConfig } from "./types";

export class DataService {
  private athenaClient: AthenaClient;

  constructor(region: string) {
    this.athenaClient = new AthenaClient({ region });
  }

  async queryTrainingData(config: TrainingConfig): Promise<TrainingExample[]> {
    const lookBackDate = new Date();
    lookBackDate.setDate(lookBackDate.getDate() - config.lookBackDays);

    // Build SQL query - adjust based on your actual Athena schema
    let query = `
      SELECT 
        article_id as articleId,
        title,
        content,
        publication_id as publication,
        published_date as publishedDate,
        metadata
      FROM ${config.athenaDatabase}.${config.athenaTable}
      WHERE published_date >= DATE('${
        lookBackDate.toISOString().split("T")[0]
      }')
        AND content IS NOT NULL
        AND title IS NOT NULL
        AND content != ''
        AND title != ''
    `;

    // Add publication filter if specified
    if (config.publicationId) {
      query += ` AND publication_id = '${config.publicationId}'`;
    }

    query += ` ORDER BY published_date DESC`;

    console.log(`Executing Athena query: ${query}`);

    // Start query execution
    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: {
        Database: config.athenaDatabase,
      },
      ResultConfiguration: {
        OutputLocation: config.athenaOutputLocation,
      },
      WorkGroup: config.athenaWorkgroup,
    });

    const startResponse = await this.athenaClient.send(startCommand);
    const queryExecutionId = startResponse.QueryExecutionId;

    if (!queryExecutionId) {
      throw new Error("Failed to start Athena query execution");
    }

    console.log(`Query execution started: ${queryExecutionId}`);

    // Wait for query to complete
    await this.waitForQueryCompletion(queryExecutionId);

    // Get query results
    const results = await this.getQueryResults(queryExecutionId);

    console.log(`Retrieved ${results.length} examples from Athena`);

    return results;
  }

  private async waitForQueryCompletion(
    queryExecutionId: string,
    maxWaitTime: number = 300000
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const getCommand = new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId,
      });

      const response = await this.athenaClient.send(getCommand);
      const state = response.QueryExecution?.Status?.State;

      if (state === QueryExecutionState.SUCCEEDED) {
        return;
      }

      if (
        state === QueryExecutionState.FAILED ||
        state === QueryExecutionState.CANCELLED
      ) {
        const reason =
          response.QueryExecution?.Status?.StateChangeReason || "Unknown error";
        throw new Error(`Query execution ${state}: ${reason}`);
      }

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error("Query execution timeout");
  }

  private async getQueryResults(
    queryExecutionId: string
  ): Promise<TrainingExample[]> {
    const results: TrainingExample[] = [];
    let nextToken: string | undefined;

    do {
      const command = new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
      });

      const response = await this.athenaClient.send(command);
      const rows = response.ResultSet?.Rows || [];

      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const data = row.Data || [];

        if (data.length >= 5) {
          const example: TrainingExample = {
            articleId: this.extractValue(data[0]),
            title: this.extractValue(data[1]),
            content: this.extractValue(data[2]),
            publication: this.extractValue(data[3]),
            publishedDate: this.extractValue(data[4]),
            metadata: data[5]
              ? JSON.parse(this.extractValue(data[5]) || "{}")
              : {},
          };
          results.push(example);
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return results;
  }

  private extractValue(data: { VarCharValue?: string }): string {
    return data.VarCharValue || "";
  }
}
