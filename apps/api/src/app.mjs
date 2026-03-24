import { randomUUID } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { cors } from "hono/cors";

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-1";
const bucket = process.env.SPOOL_S3_BUCKET || "spool-recordings-590183765115-us-west-1";
const recordingsTable = process.env.SPOOL_RECORDINGS_TABLE || "spool-share-recordings";
const cognitoUserPoolId = process.env.SPOOL_COGNITO_USER_POOL_ID || "us-west-1_CBB4q2RSR";
const cognitoClientId = process.env.SPOOL_COGNITO_CLIENT_ID || "6aua3ceout9bv35bjugjuesob5";
const shareBaseUrl = process.env.SPOOL_SHARE_BASE_URL || "";
const allowOrigin = process.env.SPOOL_SHARE_ALLOW_ORIGIN || "*";
const maxUploadBytes = Number.parseInt(
  process.env.SPOOL_MAX_UPLOAD_BYTES || `${2 * 1024 * 1024 * 1024}`,
  10
);
const maxRecordings = Number.parseInt(process.env.SPOOL_MAX_RECORDINGS || "10", 10);

if (!bucket) {
  throw new Error("SPOOL_S3_BUCKET is required");
}

if (!recordingsTable) {
  throw new Error("SPOOL_RECORDINGS_TABLE is required");
}

if (!cognitoUserPoolId || !cognitoClientId) {
  throw new Error("Cognito configuration is required.");
}

const s3 = new S3Client({ region });
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const verifier = CognitoJwtVerifier.create({
  userPoolId: cognitoUserPoolId,
  tokenUse: "access",
  clientId: cognitoClientId
});
const app = new Hono();

app.use(
  "*",
  cors({
    origin: allowOrigin,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  })
);

function buildShareBaseUrl(requestUrl) {
  if (shareBaseUrl) {
    return shareBaseUrl.replace(/\/$/, "");
  }

  return new URL(requestUrl).origin;
}

function sanitizeContentType(contentType) {
  if (typeof contentType !== "string") {
    return "video/webm";
  }

  const trimmed = contentType.trim().toLowerCase();
  if (!trimmed.startsWith("video/")) {
    return "video/webm";
  }

  return trimmed;
}

function sanitizeFileName(fileName) {
  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    return "spool-recording.webm";
  }

  return (
    fileName.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 120) ||
    "spool-recording.webm"
  );
}

function sanitizeTitle(title) {
  if (typeof title !== "string") {
    return "Untitled recording";
  }

  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 120) || "Untitled recording";
}

function getUserPartitionKey(userSub) {
  return `USER#${userSub}`;
}

function getRecordingSortKey(shareId) {
  return `RECORDING#${shareId}`;
}

function getShareIndexKey(shareId) {
  return `SHARE#${shareId}`;
}

function getObjectKey(userSub, shareId) {
  return `users/${userSub}/recordings/${shareId}.webm`;
}

function buildRecordingResponse(item, requestUrl) {
  const isComplete = item.status === "complete";
  return {
    shareId: item.shareId,
    title: item.title || "Untitled recording",
    fileName: item.fileName || "spool-recording.webm",
    contentType: item.contentType || "video/webm",
    sizeBytes: Number(item.sizeBytes || 0),
    status: item.status || "pending",
    createdAt: item.createdAt || "",
    completedAt: item.completedAt || "",
    updatedAt: item.updatedAt || "",
    shareUrl: isComplete ? `${buildShareBaseUrl(requestUrl)}/s/${item.shareId}` : "",
    objectKey: item.objectKey || ""
  };
}

async function getUserFromAuthorizationHeader(c) {
  const authorization = c.req.header("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const claims = await verifier.verify(token);
  return {
    sub: claims.sub,
    username: claims.username || ""
  };
}

async function requireAuthenticatedUser(c, next) {
  try {
    const user = await getUserFromAuthorizationHeader(c);
    if (!user?.sub) {
      return c.json(
        {
          ok: false,
          error: "Authentication is required."
        },
        401
      );
    }

    c.set("authUser", user);
    return next();
  } catch {
    return c.json(
      {
        ok: false,
        error: "Authentication is required."
      },
      401
    );
  }
}

async function getUserUsageSummary(userSub) {
  let lastEvaluatedKey;
  let totalBytes = 0;
  let recordingsUsed = 0;

  do {
    const response = await dynamodb.send(
      new QueryCommand({
        TableName: recordingsTable,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :recordingPrefix)",
        ExpressionAttributeValues: {
          ":pk": getUserPartitionKey(userSub),
          ":recordingPrefix": "RECORDING#"
        },
        ExclusiveStartKey: lastEvaluatedKey,
        ProjectionExpression: "sizeBytes, #status",
        ExpressionAttributeNames: {
          "#status": "status"
        }
      })
    );

    response.Items?.forEach((item) => {
      if (item.status === "complete" || item.status === "pending") {
        totalBytes += Number(item.sizeBytes || 0);
        recordingsUsed += 1;
      }
    });

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return {
    recordingsUsed,
    storageBytesUsed: totalBytes
  };
}

app.use("/api/share/*", requireAuthenticatedUser);

app.get("/health", (c) =>
  c.json({
    ok: true
  })
);

app.post("/api/share/init", async (c) => {
  const user = c.get("authUser");
  const payload = await c.req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return c.json(
      {
        ok: false,
        error: "Request body must be valid JSON."
      },
      400
    );
  }

  const contentType = sanitizeContentType(payload.contentType);
  const title = sanitizeTitle(payload.title);
  const fileName = sanitizeFileName(payload.fileName);
  const fileSizeBytes = Number.parseInt(`${payload.fileSizeBytes || 0}`, 10);

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return c.json(
      {
        ok: false,
        error: "fileSizeBytes must be a positive integer."
      },
      400
    );
  }

  if (fileSizeBytes > maxUploadBytes) {
    return c.json(
      {
        ok: false,
        error: `Recording exceeds the ${maxUploadBytes}-byte upload limit.`
      },
      413
    );
  }

  const usage = await getUserUsageSummary(user.sub);
  if (usage.recordingsUsed >= maxRecordings) {
    return c.json(
      {
        ok: false,
        error: `You've reached the ${maxRecordings} recording limit. Email george@webhouse.dev to increase your limit.`,
        recordingsLimit: maxRecordings,
        recordingsUsed: usage.recordingsUsed,
        storageBytesUsed: usage.storageBytesUsed
      },
      403
    );
  }

  const shareId = randomUUID().replace(/-/g, "");
  const objectKey = getObjectKey(user.sub, shareId);
  const now = new Date().toISOString();

  await dynamodb.send(
    new PutCommand({
      TableName: recordingsTable,
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      Item: {
        pk: getUserPartitionKey(user.sub),
        sk: getRecordingSortKey(shareId),
        gsi1pk: getShareIndexKey(shareId),
        gsi1sk: "RECORDING",
        contentType,
        createdAt: now,
        fileName,
        objectKey,
        ownerSub: user.sub,
        shareId,
        sizeBytes: fileSizeBytes,
        status: "pending",
        title,
        updatedAt: now
      }
    })
  );

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
      Metadata: {
        originalfilename: fileName,
        ownersub: user.sub
      }
    }),
    {
      expiresIn: 900
    }
  );

  return c.json({
    ok: true,
    bucket,
    region,
    shareId,
    objectKey,
    uploadUrl,
    uploadMethod: "PUT",
    uploadHeaders: {
      "content-type": contentType
    },
    shareUrl: `${buildShareBaseUrl(c.req.url)}/s/${shareId}`,
    recordingsLimit: maxRecordings,
    recordingsUsed: usage.recordingsUsed + 1,
    storageBytesUsed: usage.storageBytesUsed + fileSizeBytes
  });
});

app.post("/api/share/videos/:shareId/title", async (c) => {
  const user = c.get("authUser");
  const shareId = c.req.param("shareId");
  const payload = await c.req.json().catch(() => null);

  if (!/^[a-f0-9]{32}$/.test(shareId)) {
    return c.json(
      {
        ok: false,
        error: "shareId is required."
      },
      400
    );
  }

  const title = sanitizeTitle(payload?.title);
  const fileName = sanitizeFileName(payload?.fileName || `${title}.webm`);
  const updatedAt = new Date().toISOString();

  await dynamodb.send(
    new UpdateCommand({
      TableName: recordingsTable,
      Key: {
        pk: getUserPartitionKey(user.sub),
        sk: getRecordingSortKey(shareId)
      },
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
      UpdateExpression: "SET title = :title, fileName = :fileName, updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":title": title,
        ":fileName": fileName,
        ":updatedAt": updatedAt
      }
    })
  );

  return c.json({
    ok: true,
    shareId,
    title,
    fileName,
    updatedAt
  });
});

app.post("/api/share/complete", async (c) => {
  const user = c.get("authUser");
  const payload = await c.req.json().catch(() => null);
  const shareId = typeof payload?.shareId === "string" ? payload.shareId.trim() : "";

  if (!/^[a-f0-9]{32}$/.test(shareId)) {
    return c.json(
      {
        ok: false,
        error: "shareId is required."
      },
      400
    );
  }

  const key = {
    pk: getUserPartitionKey(user.sub),
    sk: getRecordingSortKey(shareId)
  };

  const existing = await dynamodb.send(
    new GetCommand({
      TableName: recordingsTable,
      Key: key
    })
  );

  if (!existing.Item) {
    return c.json(
      {
        ok: false,
        error: "Recording not found."
      },
      404
    );
  }

  const objectHead = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: existing.Item.objectKey
    })
  );

  const updatedAt = new Date().toISOString();
  await dynamodb.send(
    new UpdateCommand({
      TableName: recordingsTable,
      Key: key,
      UpdateExpression:
        "SET #status = :status, completedAt = :completedAt, updatedAt = :updatedAt, sizeBytes = :sizeBytes",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "complete",
        ":completedAt": updatedAt,
        ":updatedAt": updatedAt,
        ":sizeBytes": Number(objectHead.ContentLength || existing.Item.sizeBytes || 0)
      }
    })
  );

  return c.json({
    ok: true,
    shareId,
    shareUrl: `${buildShareBaseUrl(c.req.url)}/s/${shareId}`,
    sizeBytes: Number(objectHead.ContentLength || existing.Item.sizeBytes || 0)
  });
});

app.get("/api/share/videos", async (c) => {
  const user = c.get("authUser");
  const response = await dynamodb.send(
    new QueryCommand({
      TableName: recordingsTable,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :recordingPrefix)",
      ExpressionAttributeValues: {
        ":pk": getUserPartitionKey(user.sub),
        ":recordingPrefix": "RECORDING#"
      }
    })
  );

  const recordings = (response.Items || [])
    .map((item) => buildRecordingResponse(item, c.req.url))
    .sort((left, right) => {
      const rightTimestamp = Date.parse(right.completedAt || right.createdAt || "") || 0;
      const leftTimestamp = Date.parse(left.completedAt || left.createdAt || "") || 0;
      return rightTimestamp - leftTimestamp;
    });

  return c.json({
    ok: true,
    recordings,
    count: recordings.length,
    recordingsLimit: maxRecordings,
    recordingsUsed: recordings.length,
    storageBytesUsed: (await getUserUsageSummary(user.sub)).storageBytesUsed
  });
});

app.get("/api/share/videos/:shareId", async (c) => {
  const user = c.get("authUser");
  const shareId = c.req.param("shareId");

  if (!/^[a-f0-9]{32}$/.test(shareId)) {
    return c.json(
      {
        ok: false,
        error: "shareId is required."
      },
      400
    );
  }

  const response = await dynamodb.send(
    new GetCommand({
      TableName: recordingsTable,
      Key: {
        pk: getUserPartitionKey(user.sub),
        sk: getRecordingSortKey(shareId)
      }
    })
  );

  if (!response.Item) {
    return c.json(
      {
        ok: false,
        error: "Recording not found."
      },
      404
    );
  }

  return c.json({
    ok: true,
    recording: buildRecordingResponse(response.Item, c.req.url)
  });
});

app.delete("/api/share/videos/:shareId", async (c) => {
  const user = c.get("authUser");
  const shareId = c.req.param("shareId");

  if (!/^[a-f0-9]{32}$/.test(shareId)) {
    return c.json(
      {
        ok: false,
        error: "shareId is required."
      },
      400
    );
  }

  const key = {
    pk: getUserPartitionKey(user.sub),
    sk: getRecordingSortKey(shareId)
  };

  const existing = await dynamodb.send(
    new GetCommand({
      TableName: recordingsTable,
      Key: key
    })
  );

  if (!existing.Item) {
    return c.json(
      {
        ok: false,
        error: "Recording not found."
      },
      404
    );
  }

  if (existing.Item.objectKey) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: existing.Item.objectKey
        })
      );
    } catch (error) {
      const isMissing = error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound";
      if (!isMissing) {
        throw error;
      }
    }
  }

  await dynamodb.send(
    new DeleteCommand({
      TableName: recordingsTable,
      Key: key
    })
  );

  return c.json({
    ok: true,
    shareId,
    recordingsLimit: maxRecordings,
    ...(await getUserUsageSummary(user.sub))
  });
});

app.get("/s/:shareId", async (c) => {
  const shareId = c.req.param("shareId");
  if (!/^[a-f0-9]{32}$/.test(shareId)) {
    return c.text("Share not found.", 404);
  }

  const recordQuery = await dynamodb.send(
    new QueryCommand({
      TableName: recordingsTable,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :gsi1pk AND gsi1sk = :gsi1sk",
      ExpressionAttributeValues: {
        ":gsi1pk": getShareIndexKey(shareId),
        ":gsi1sk": "RECORDING"
      },
      Limit: 1
    })
  );

  const record = recordQuery.Items?.[0];
  if (!record || record.status !== "complete") {
    return c.text("Share not found.", 404);
  }

  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: record.objectKey
      })
    );
    const fileName = sanitizeFileName(head.Metadata?.originalfilename || record.fileName || `spool-${shareId}.webm`);
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: record.objectKey,
        ResponseContentType: head.ContentType || record.contentType || "video/webm",
        ResponseContentDisposition: `inline; filename="${fileName}"`
      }),
      {
        expiresIn: 3600
      }
    );

    return Response.redirect(downloadUrl, 302);
  } catch (error) {
    const isMissing = error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound";
    return c.text(isMissing ? "Share not found." : "Failed to resolve share.", isMissing ? 404 : 500);
  }
});

app.notFound((c) =>
  c.json(
    {
      ok: false,
      error: "Not found."
    },
    404
  )
);

app.onError((error, c) =>
  c.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "Internal server error."
    },
    500
  )
);

export default app;
