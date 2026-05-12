import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";
import alasql from "alasql";

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MOCK_SCHEMA = `
Table: SalesData
Columns:
- date (DATE)
- region (VARCHAR)
- product_category (VARCHAR)
- revenue (DECIMAL)
- units_sold (INTEGER)
`;

const SYSTEM_INSTRUCTION = `
You are an expert Data Engineer. Your task is to translate natural language questions into SQL queries based on the provided database schema.
You must return a strictly formatted JSON response.

Rules:
1. Only return the JSON object.
2. The JSON object must match this structure: { "sql_query": "...", "chart_type": "..." }
3. sql_query should be a valid SQL string for the provided schema.
4. chart_type should be a recommendation (e.g., "bar", "line", "pie", "table").
`;

async function generateSqlFromNL(userQuestion) {
  try {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_INSTRUCTION,
    });

    const generationConfig = {
      temperature: 0,
      responseMimeType: "application/json",
    };

    const prompt = `
Schema:
${MOCK_SCHEMA}

User Question: "${userQuestion}"
`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    });

    const responseText = result.response.text();
    const parsedJson = JSON.parse(responseText);

    console.log("\nTranslation Successful:");
    console.log(JSON.stringify(parsedJson, null, 2));
    
    // Phase 2: Execute SQL Query using alasql
    console.log("\nExecuting Query against CSV...");
    try {
      // 1. Read CSV data into a JavaScript array
      const csvData = await alasql.promise("SELECT * FROM CSV('sales_data.csv', {headers:true})");
      
      // 2. Create the table and load the data
      await alasql.promise("CREATE TABLE SalesData");
      await alasql.promise("SELECT * INTO SalesData FROM ?", [csvData]);
      
      // 3. Execute the generated query
      const sqlResult = await alasql.promise(parsedJson.sql_query);
      
      console.log("Query Results:");
      if (sqlResult && sqlResult.length > 0) {
        console.table(sqlResult);
      } else {
        console.log("No data found matching the criteria.");
      }

      // Clean up for next run
      await alasql.promise("DROP TABLE SalesData");

      return {
        ...parsedJson,
        data: sqlResult
      };
    } catch (dbError) {
      console.error("Internal SQL Error:", dbError.message);
    }
    
    return parsedJson;
  } catch (error) {
    console.error("Error generating SQL from NL:", error.message);
    if (error.response) {
      console.error("Response Details:", error.response.data);
    }
  }
}

// Sample execution (awaiting API key)
const sampleQuestion = "What is the total revenue for Electronics in the North region?";
console.log(`Analyzing: "${sampleQuestion}"...`);
generateSqlFromNL(sampleQuestion);
