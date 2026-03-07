import axios, { AxiosError, AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export type BookStatus = 'in_stock' | 'reserved' | 'issued';
export type Difficulty = 'basic' | 'medium' | 'advanced';
export type SectionTag = 'recommended' | 'new' | 'commander';

export interface CreateBookRequest {
  title: string;
  author: string;
  coverUrl: string;
  status?: BookStatus;
  description?: string;
  difficulty?: Difficulty;
  popularityScore?: number;
  sectionTags?: SectionTag[];
}

export interface Book extends CreateBookRequest {
  id: string;
}

export interface PaginatedBooks {
  items: Book[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'returned';

/** Nested book in reservation response (from populate). */
export interface ReservationBook {
  id: string;
  title: string;
  author: string;
  status: string;
}

export interface Reservation {
  id: string;
  bookId: string;
  status: ReservationStatus;
  createdAt: string;
  fullName?: string | null;
  phone?: string | null;
  subdivision?: string | null;
  comment?: string | null;
  book?: ReservationBook | null;
}

export interface PaginatedReservations {
  items: Reservation[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const baseURL = process.env.BASE_API_URL || 'http://localhost:3000';

const client: AxiosInstance = axios.create({
  baseURL: `${baseURL}/api`,
  timeout: 10000,
});

const isAxiosError = (error: unknown): error is AxiosError =>
  !!error && typeof error === 'object' && 'isAxiosError' in error;

const buildErrorMessage = (error: unknown, fallback: string): string => {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const detail =
      (error.response?.data as { message?: string } | undefined)?.message;
    if (status) {
      return `${fallback} (status ${status}${
        detail ? `: ${detail}` : ''
      })`.trim();
    }

    if (error.message) {
      return `${fallback}: ${error.message}`;
    }
  }

  // Handle AggregateError explicitly so that we don't just see the generic name.
  if (typeof (globalThis as unknown as { AggregateError?: ErrorConstructor })
    .AggregateError !== 'undefined') {
    const AggErr = (globalThis as unknown as {
      AggregateError?: ErrorConstructor;
    }).AggregateError;

    if (AggErr && error instanceof AggErr) {
      const anyError = error as unknown as
        | Error
        | (Error & { errors?: unknown[] });

      const innerMessages =
        (anyError as { errors?: unknown[] }).errors?.map((e) =>
          e instanceof Error ? e.message : String(e),
        );

      const combined =
        innerMessages && innerMessages.length
          ? innerMessages.join('; ')
          : anyError.message || 'AggregateError';

      return `${fallback}: ${combined}`;
    }
  }

  return `${fallback}: ${String(error)}`;
};

/**
 * Creates a new book using POST /api/books.
 */
export const createBook = async (
  payload: CreateBookRequest,
): Promise<Book> => {
  try {
    const response = await client.post<Book>('/books', payload);
    return response.data;
  } catch (error) {
    throw new Error(buildErrorMessage(error, 'Не вдалося створити книгу'));
  }
};

/**
 * Fetches a single book by ID using GET /api/books/{id}.
 */
export const getBook = async (id: string): Promise<Book> => {
  try {
    const response = await client.get<Book>(`/books/${id}`);
    return response.data;
  } catch (error) {
    throw new Error(buildErrorMessage(error, 'Не вдалося завантажити книгу'));
  }
};

/**
 * Lists books using GET /api/books with pagination.
 * Supports array response or paginated { items, page, pageSize, totalItems, totalPages }.
 */
export const listBooks = async (params: {
  page: number;
  pageSize: number;
}): Promise<PaginatedBooks> => {
  try {
    const response = await client.get<unknown>('/books', {
      params: { page: params.page, pageSize: params.pageSize },
    });
    const data = response.data;

    if (Array.isArray(data)) {
      const all = data as Book[];
      const totalItems = all.length;
      const page = Math.max(1, params.page);
      const pageSize = Math.max(1, params.pageSize);
      const start = (page - 1) * pageSize;
      const items = all.slice(start, start + pageSize);
      const totalPages =
        totalItems > 0 ? Math.ceil(totalItems / pageSize) : 0;
      return {
        items,
        page,
        pageSize,
        totalItems,
        totalPages,
      };
    }

    if (
      data &&
      typeof data === 'object' &&
      'items' in data &&
      Array.isArray((data as { items: unknown }).items)
    ) {
      const raw = data as {
        items: Book[];
        page?: number;
        pageSize?: number;
        totalItems?: number;
        totalPages?: number;
      };
      const items = raw.items;
      const totalItems =
        typeof raw.totalItems === 'number' ? raw.totalItems : items.length;
      const pageSize =
        typeof raw.pageSize === 'number' ? raw.pageSize : items.length;
      const totalPages =
        typeof raw.totalPages === 'number'
          ? raw.totalPages
          : pageSize > 0
            ? Math.ceil(totalItems / pageSize)
            : 0;
      const page =
        typeof raw.page === 'number' ? raw.page : 1;
      return {
        items,
        page,
        pageSize,
        totalItems,
        totalPages,
      };
    }

    return {
      items: [],
      page: 1,
      pageSize: params.pageSize,
      totalItems: 0,
      totalPages: 0,
    };
  } catch (error) {
    throw new Error(
      buildErrorMessage(error, 'Не вдалося завантажити список книг'),
    );
  }
};

/**
 * Deletes a book using DELETE /api/books/{id}.
 */
export const deleteBook = async (id: string): Promise<void> => {
  try {
    await client.delete(`/books/${id}`);
  } catch (error) {
    throw new Error(buildErrorMessage(error, 'Не вдалося видалити книгу'));
  }
};

export interface ListReservationsParams {
  page?: number;
  pageSize?: number;
  status?: ReservationStatus;
}

/**
 * Lists reservations using GET /api/reservations.
 */
export const listReservations = async (
  params: ListReservationsParams = {},
): Promise<PaginatedReservations> => {
  try {
    const response = await client.get<PaginatedReservations>('/reservations', {
      params,
    });
    return response.data;
  } catch (error) {
    throw new Error(
      buildErrorMessage(
        error,
        'Не вдалося завантажити список замовлень/бронювань',
      ),
    );
  }
};

/**
 * Updates reservation status using PATCH /api/reservations/{id}/status.
 */
export const updateReservationStatus = async (
  id: string,
  status: ReservationStatus,
): Promise<Reservation> => {
  try {
    const response = await client.patch<Reservation>(
      `/reservations/${id}/status`,
      { status },
    );
    return response.data;
  } catch (error) {
    throw new Error(
      buildErrorMessage(error, 'Не вдалося оновити статус замовлення'),
    );
  }
};

