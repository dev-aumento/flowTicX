import { GridFSBucket, ObjectId } from "mongodb";
import { getMongoDb } from "./mongo";
import {
  deleteAttachmentFromGridFs,
  downloadAttachmentFromGridFs,
  uploadAttachmentToGridFs,
} from "./attachment-storage";

const EMPLOYEE_BUCKET = "employee_files";

async function getEmployeeBucket() {
  const db = await getMongoDb();
  return new GridFSBucket(db, { bucketName: EMPLOYEE_BUCKET });
}

export async function uploadEmployeeDocumentToGridFs(args: {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{ gridFsId: string; byteLength: number }> {
  const bucket = await getEmployeeBucket();
  const buffer = Buffer.from(args.dataBase64, "base64");

  const uploadStream = bucket.openUploadStream(args.fileName, {
    contentType: args.mimeType || "application/octet-stream",
    metadata: { source: "employee_document" },
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

export async function downloadEmployeeDocumentFromGridFs(gridFsId: string): Promise<Buffer> {
  try {
    const bucket = await getEmployeeBucket();
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
  } catch {
    // Fall back to task bucket if a file was stored with the shared helper.
    return downloadAttachmentFromGridFs(gridFsId);
  }
}

export async function deleteEmployeeDocumentFromGridFs(gridFsId: string): Promise<void> {
  try {
    const bucket = await getEmployeeBucket();
    await bucket.delete(new ObjectId(gridFsId));
  } catch {
    await deleteAttachmentFromGridFs(gridFsId);
  }
}

/** Prefer dedicated employee bucket; keep shared helper available for tests. */
export { uploadAttachmentToGridFs };
