import { GridFSBucket, ObjectId, type GridFSFile } from "mongodb";
import { getMongoDb } from "./mongo";

const BUCKET_NAME = "task_files";

async function getBucket() {
  const db = await getMongoDb();
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

export async function uploadAttachmentToGridFs(args: {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{ gridFsId: string; byteLength: number }> {
  const bucket = await getBucket();
  const buffer = Buffer.from(args.dataBase64, "base64");

  const uploadStream = bucket.openUploadStream(args.fileName, {
    contentType: args.mimeType || "application/octet-stream",
    metadata: { source: "task_attachment" },
  });

  await new Promise<void>((resolve, reject) => {
    uploadStream.once("finish", () => resolve());
    uploadStream.once("error", reject);
    uploadStream.end(buffer);
  });

  return {
    gridFsId: uploadStream.id.toHexString(),
    byteLength: buffer.byteLength,
  };
}

export async function downloadAttachmentFromGridFs(gridFsId: string): Promise<Buffer> {
  const bucket = await getBucket();
  const id = new ObjectId(gridFsId);
  const downloadStream = bucket.openDownloadStream(id);
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    downloadStream.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    downloadStream.once("error", reject);
    downloadStream.once("end", () => resolve());
  });

  return Buffer.concat(chunks);
}

export async function deleteAttachmentFromGridFs(gridFsId: string): Promise<void> {
  try {
    const bucket = await getBucket();
    await bucket.delete(new ObjectId(gridFsId));
  } catch {
    // Missing GridFS object shouldn't block metadata cleanup.
  }
}

export async function getGridFsFileMeta(gridFsId: string): Promise<GridFSFile | null> {
  const bucket = await getBucket();
  const files = await bucket.find({ _id: new ObjectId(gridFsId) }).limit(1).toArray();
  return files[0] ?? null;
}
