import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  PutRolePolicyCommand
} from "@aws-sdk/client-iam";
import {
  LambdaClient,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  CreateFunctionCommand,
  GetFunctionUrlConfigCommand,
  CreateFunctionUrlConfigCommand,
  UpdateFunctionUrlConfigCommand,
  AddPermissionCommand
} from "@aws-sdk/client-lambda";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distZipPath = join(__dirname, "..", "dist", "lambda.zip");

const functionName = process.env.SPOOL_LAMBDA_FUNCTION_NAME || "spool-share-api";
const roleName = process.env.SPOOL_LAMBDA_ROLE_NAME || "spool-share-api-role";
const policyName = process.env.SPOOL_LAMBDA_POLICY_NAME || "spool-share-api-s3";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-1";
const bucket = process.env.SPOOL_S3_BUCKET || "spool-recordings-590183765115-us-west-1";
const recordingsTable = process.env.SPOOL_RECORDINGS_TABLE || "spool-share-recordings";
const cognitoUserPoolId = process.env.SPOOL_COGNITO_USER_POOL_ID || "us-west-1_CBB4q2RSR";
const cognitoClientId = process.env.SPOOL_COGNITO_CLIENT_ID || "6aua3ceout9bv35bjugjuesob5";
const allowOrigin = process.env.SPOOL_SHARE_ALLOW_ORIGIN || "*";
const maxUploadBytes = process.env.SPOOL_MAX_UPLOAD_BYTES || "2147483648";
const shareBaseUrl = process.env.SPOOL_SHARE_BASE_URL || "";

const iam = new IAMClient({ region });
const lambda = new LambdaClient({ region });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLambdaConflictRetry(task) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (error.name !== "ResourceConflictException" || attempt === 5) {
        throw error;
      }

      await waitForFunctionReady();
      await sleep(1000);
    }
  }
}

async function ensureRole() {
  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    return existing.Role?.Arn;
  } catch (error) {
    if (error.name !== "NoSuchEntity") {
      throw error;
    }
  }

  const assumeRolePolicyDocument = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com"
        },
        Action: "sts:AssumeRole"
      }
    ]
  });

  const created = await iam.send(
    new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: assumeRolePolicyDocument
    })
  );

  await iam.send(
    new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    })
  );

  return created.Role?.Arn;
}

async function ensureInlinePolicy() {
  const policyDocument = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: `arn:aws:s3:::${bucket}/*`
      },
      {
        Effect: "Allow",
        Action: [
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ],
        Resource: [
          `arn:aws:dynamodb:${region}:*:table/${recordingsTable}`,
          `arn:aws:dynamodb:${region}:*:table/${recordingsTable}/index/*`
        ]
      }
    ]
  });

  await iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: policyName,
      PolicyDocument: policyDocument
    })
  );
}

function getEnvironmentVariables() {
  const variables = {
    SPOOL_S3_BUCKET: bucket,
    SPOOL_RECORDINGS_TABLE: recordingsTable,
    SPOOL_COGNITO_USER_POOL_ID: cognitoUserPoolId,
    SPOOL_COGNITO_CLIENT_ID: cognitoClientId,
    SPOOL_SHARE_ALLOW_ORIGIN: allowOrigin,
    SPOOL_MAX_UPLOAD_BYTES: maxUploadBytes
  };

  if (shareBaseUrl) {
    variables.SPOOL_SHARE_BASE_URL = shareBaseUrl;
  }

  return variables;
}

async function ensureFunction(roleArn, zipBuffer) {
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));

    await withLambdaConflictRetry(() =>
      lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionName,
        ZipFile: zipBuffer
      })
      )
    );

    await waitForFunctionReady();

    await withLambdaConflictRetry(() =>
      lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Runtime: "nodejs20.x",
        Handler: "index.handler",
        Timeout: 30,
        MemorySize: 512,
        Role: roleArn,
        Environment: {
          Variables: getEnvironmentVariables()
        }
      })
      )
    );
    return;
  } catch (error) {
    if (error.name !== "ResourceNotFoundException") {
      throw error;
    }
  }

  await withLambdaConflictRetry(() =>
    lambda.send(
    new CreateFunctionCommand({
      FunctionName: functionName,
      Runtime: "nodejs20.x",
      Handler: "index.handler",
      Timeout: 30,
      MemorySize: 512,
      Role: roleArn,
      Code: {
        ZipFile: zipBuffer
      },
      Environment: {
        Variables: getEnvironmentVariables()
      }
    })
    )
  );
}

async function waitForFunctionReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const configuration = await lambda.send(
      new GetFunctionConfigurationCommand({
        FunctionName: functionName
      })
    );
    if (
      configuration.State === "Active" &&
      (!configuration.LastUpdateStatus || configuration.LastUpdateStatus === "Successful")
    ) {
      return configuration;
    }

    if (
      configuration.State === "Failed" ||
      configuration.LastUpdateStatus === "Failed"
    ) {
      throw new Error(
        configuration.StateReason ||
          configuration.LastUpdateStatusReason ||
          "Lambda function failed to become ready."
      );
    }

    await sleep(3000);
  }

  throw new Error("Timed out waiting for Lambda function to become ready.");
}

async function ensureFunctionUrl() {
  const cors = {
    AllowCredentials: false,
    AllowHeaders: ["authorization", "content-type"],
    AllowMethods: ["GET", "POST", "DELETE"],
    AllowOrigins: ["*"],
    MaxAge: 3000
  };
  let functionUrl = "";

  try {
    const existing = await lambda.send(
      new GetFunctionUrlConfigCommand({
        FunctionName: functionName
      })
    );

    const updated = await withLambdaConflictRetry(() =>
      lambda.send(
      new UpdateFunctionUrlConfigCommand({
        FunctionName: functionName,
        AuthType: "NONE",
        Cors: cors
      })
      )
    );

    functionUrl = updated.FunctionUrl || existing.FunctionUrl || "";
  } catch (error) {
    if (error.name !== "ResourceNotFoundException") {
      throw error;
    } else {
      const created = await withLambdaConflictRetry(() =>
        lambda.send(
        new CreateFunctionUrlConfigCommand({
          FunctionName: functionName,
          AuthType: "NONE",
          Cors: cors
        })
        )
      );

      functionUrl = created.FunctionUrl || "";
    }
  }

  try {
    await withLambdaConflictRetry(() =>
      lambda.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: "FunctionUrlPublicAccess",
        Action: "lambda:InvokeFunctionUrl",
        Principal: "*",
        FunctionUrlAuthType: "NONE"
      })
      )
    );
  } catch (error) {
    if (error.name !== "ResourceConflictException") {
      throw error;
    }
  }

  try {
    await withLambdaConflictRetry(() =>
      lambda.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: "FunctionUrlInvokeFunctionPublicAccess",
        Action: "lambda:InvokeFunction",
        Principal: "*"
      })
      )
    );
  } catch (error) {
    if (error.name !== "ResourceConflictException") {
      throw error;
    }
  }

  return functionUrl;
}

async function main() {
  const zipBuffer = await readFile(distZipPath);
  const roleArn = await ensureRole();
  if (!roleArn) {
    throw new Error("Unable to resolve Lambda role ARN.");
  }

  await ensureInlinePolicy();
  await ensureFunction(roleArn, zipBuffer);
  await waitForFunctionReady();
  const functionUrl = await ensureFunctionUrl();

  process.stdout.write(`${functionUrl}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
