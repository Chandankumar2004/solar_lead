import { Response } from "express";

export type ApiPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ApiError = {
  code: string;
  details?: unknown;
};

type Envelope<T> = {
  success: boolean;
  data: T | null;
  message: string;
  error: ApiError | null;
  pagination: ApiPagination | null;
};

function send<T>(res: Response, status: number, payload: Envelope<T>) {
  return res.status(status).json(payload);
}

export function ok<T>(
  res: Response,
  data: T,
  message = "OK",
  pagination: ApiPagination | null = null
) {
  return send(res, 200, {
    success: true,
    data,
    message,
    error: null,
    pagination
  });
}

export function created<T>(res: Response, data: T, message = "Created") {
  return send(res, 201, {
    success: true,
    data,
    message,
    error: null,
    pagination: null
  });
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return send(res, status, {
    success: false,
    data: null,
    message,
    error: {
      code,
      details
    },
    pagination: null
  });
}

