/**
 * The readable reason from a failed reply (#1396).
 *
 * The backend answers an error with JSON `{ detail }`, and the page read it
 * with `resp.json()`. A reply that wasn't JSON — an unhandled server error
 * comes back as plain-text "Internal Server Error" — made `resp.json()`
 * throw, and the notice showed the parser's words instead of the server's:
 * in the Mac app, WebKit's "SyntaxError: The string did not match the
 * expected pattern." So read the body as text, use its `detail` when it is
 * JSON, and otherwise show the text itself.
 */
export async function errorDetail(
  resp: Pick<Response, "text" | "status" | "statusText">,
): Promise<string> {
  let text = "";
  try {
    text = await resp.text();
  } catch {
    // The body couldn't be read: fall back to the status below.
  }
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && "detail" in body && body.detail != null && body.detail !== "") {
      return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // Not JSON: the text itself is the message.
  }
  return text.trim() || resp.statusText || `HTTP ${resp.status}`;
}
