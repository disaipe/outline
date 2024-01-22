import emojiRegex from "emoji-regex";
import escapeRegExp from "lodash/escapeRegExp";
import truncate from "lodash/truncate";
import { Transaction } from "sequelize";
import parseTitle from "@shared/utils/parseTitle";
import { DocumentValidation } from "@shared/validations";
import { traceFunction } from "@server/logging/tracing";
import { User } from "@server/models";
import ProsemirrorHelper from "@server/models/helpers/ProsemirrorHelper";
import TextHelper from "@server/models/helpers/TextHelper";
import { DocumentConverter } from "@server/utils/DocumentConverter";
import { InvalidRequestError } from "../errors";

type Props = {
  user: User;
  mimeType: string;
  fileName: string;
  content: Buffer | string;
  ip?: string;
  transaction?: Transaction;
};

async function documentImporter({
  mimeType,
  fileName,
  content,
  user,
  ip,
  transaction,
}: Props): Promise<{
  emoji?: string;
  text: string;
  title: string;
  state: Buffer;
}> {
  let text = await DocumentConverter.convertToMarkdown(
    content,
    fileName,
    mimeType
  );
  let title = fileName.replace(/\.[^/.]+$/, "");

  // find and extract emoji near the beginning of the document.
  const regex = emojiRegex();
  const matches = regex.exec(text.slice(0, 10));
  const emoji = matches ? matches[0] : undefined;
  if (emoji) {
    text = text.replace(emoji, "");
  }

  // If the first line of the imported text looks like a markdown heading
  // then we can use this as the document title rather than the file name.
  if (text.trim().startsWith("# ")) {
    const result = parseTitle(text);
    title = result.title;
    text = text
      .trim()
      .replace(new RegExp(`#\\s+${escapeRegExp(title)}`), "")
      .trimStart();
  }

  // Replace any <br> generated by the turndown plugin with escaped newlines
  // to match our hardbreak parser.
  text = text.trim().replace(/<br>/gi, "\\n");

  // Escape any dollar signs in the text to prevent them being interpreted as
  // math blocks
  text = text.replace(/\$/g, "\\$");

  // Remove any closed and immediately reopened formatting marks
  text = text.replace(/\*\*\*\*/gi, "").replace(/____/gi, "");

  text = await TextHelper.replaceImagesWithAttachments(
    text,
    user,
    ip,
    transaction
  );

  // It's better to truncate particularly long titles than fail the import
  title = truncate(title, { length: DocumentValidation.maxTitleLength });

  const ydoc = ProsemirrorHelper.toYDoc(text);
  const state = ProsemirrorHelper.toState(ydoc);

  if (state.length > DocumentValidation.maxStateLength) {
    throw InvalidRequestError(
      `The document "${title}" is too large to import, please reduce the length and try again`
    );
  }

  return {
    text,
    state,
    title,
    emoji,
  };
}

export default traceFunction({
  spanName: "documentImporter",
})(documentImporter);
