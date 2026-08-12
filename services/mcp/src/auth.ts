import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function bearerAuth(token: string | undefined): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!token) {
      next();
      return;
    }

    const authorization = request.header("authorization");
    const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!supplied || !constantTimeEqual(supplied, token)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="project-ambient"');
      response.status(401).json({ error: "unauthorized", message: "A valid bearer token is required." });
      return;
    }
    next();
  };
}
