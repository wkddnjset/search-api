export class AppError extends Error {
  constructor(
    public id: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ErrorResponse {
  type: 'ErrorResponse';
  error: {
    id: string;
    status: number;
    message: string;
  };
}
