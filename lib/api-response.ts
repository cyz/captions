interface ApiErrorBody {
  error?: unknown;
}

function responseErrorMessage(response: Response, body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const { error } = body as ApiErrorBody;
    if (typeof error === "string" && error.trim()) return error;
  }

  const status = response.status
    ? ` (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`
    : "";
  return `The server could not complete the request${status}.`;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) {
        throw new Error("The server returned an invalid response.");
      }
    }
  }

  if (!response.ok) {
    throw new Error(responseErrorMessage(response, body));
  }

  if (body === undefined) {
    throw new Error("The server returned an empty response.");
  }

  return body as T;
}
