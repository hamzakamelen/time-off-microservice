import {
  Injectable,
  Logger,
  HttpException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import axios from 'axios';

/**
 * Shape of a single balance record returned by HCM.
 */
export interface HcmBalanceRecord {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

/**
 * Shape of the response when we submit time-off to HCM.
 */
export interface HcmTimeOffResponse {
  success: boolean;
  referenceId?: string;
  error?: string;
}

/**
 * Wraps all HTTP calls to the external HCM system.
 * Handles retries, timeouts, and error mapping so the rest
 * of the app never deals with raw HTTP errors from HCM.
 *
 * Timeout is configured at the module level (HttpModule.register).
 * Retry is handled in this service for transient failures.
 */
@Injectable()
export class HcmClientService {
  private readonly logger = new Logger(HcmClientService.name);
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService.get<string>('HCM_BASE_URL') ||
      'http://127.0.0.1:3001/api/hcm';
    this.maxRetries = parseInt(
      this.configService.get<string>('HCM_MAX_RETRIES') || '2',
      10,
    );
  }

  /**
   * Fetch a single employee's balance from HCM (real-time API).
   */
  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<HcmBalanceRecord> {
    const url = `${this.baseUrl}/balance/${employeeId}/${locationId}?leaveType=${leaveType}`;
    this.logger.log(`Fetching balance from URL: ${url}`);
    return this.executeWithRetry<HcmBalanceRecord>(
      () => firstValueFrom(this.httpService.get<HcmBalanceRecord>(url)),
      'balance fetch',
    );
  }

  /**
   * Submit a time-off request to HCM for deduction.
   * Does NOT throw on HCM rejection — returns { success: false } instead.
   */
  async submitTimeOff(request: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    numberOfDays: number;
  }): Promise<HcmTimeOffResponse> {
    try {
      this.logger.log(
        `Submitting time-off to HCM for employee ${request.employeeId}. URL: ${this.baseUrl}/time-off`,
      );

      const response = await this.executeWithRetry(
        () =>
          firstValueFrom(
            this.httpService.post<HcmTimeOffResponse>(
              `${this.baseUrl}/time-off`,
              request,
            ),
          ),
        'time-off submission',
      );
      return response;
    } catch (error: unknown) {
      // If it's already a Nest exception, we can extract the message for the response object
      if (error instanceof HttpException) {
        return {
          success: false,
          error: error.message,
        };
      }
      
      // Fallback for raw Axios errors that might have bypassed executeWithRetry mapping
      if (axios.isAxiosError(error) && error.response?.data) {
        const hcmError = error.response.data as { error?: string; message?: string };
        return {
          success: false,
          error: hcmError.error || hcmError.message || 'HCM rejected the request',
        };
      }
      const message =
        error instanceof Error ? error.message : 'Unknown HCM error';
      this.logger.error(`Failed to submit time-off to HCM: ${message}`);
      return { success: false, error: `HCM communication failed: ${message}` };
    }
  }

  /**
   * Cancel a previously submitted time-off in HCM.
   */
  async cancelTimeOff(hcmReferenceId: string): Promise<HcmTimeOffResponse> {
    try {
      this.logger.log(
        `Cancelling time-off in HCM: reference ${hcmReferenceId}`,
      );

      const response = await firstValueFrom(
        this.httpService.delete<HcmTimeOffResponse>(
          `${this.baseUrl}/time-off/${hcmReferenceId}`,
        ),
      );
      return response.data;
    } catch (error: unknown) {
      throw this.mapHcmError(error, 'time-off cancellation');
    }
  }

  /**
   * Fetch ALL balances from HCM (batch endpoint).
   * Used for periodic full sync.
   */
  async getAllBalances(): Promise<HcmBalanceRecord[]> {
    const url = `${this.baseUrl}/balances/batch`;
    return this.executeWithRetry<HcmBalanceRecord[]>(
      () => firstValueFrom(this.httpService.get<HcmBalanceRecord[]>(url)),
      'batch balance fetch',
    );
  }

  // ─── PRIVATE HELPERS ──────────────────────────────────────

  /**
   * Retry wrapper for transient HCM failures.
   * Retries up to maxRetries times with a small delay.
   * Only retries on network/timeout errors, NOT on 4xx responses.
   */
  private async executeWithRetry<T>(
    operation: () => Promise<{ data: T }>,
    operationName: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        this.logger.log(
          `HCM ${operationName} — attempt ${attempt}/${this.maxRetries + 1}`,
        );
        const response = await operation();
        return response.data;
      } catch (error: unknown) {
        lastError = error;

        // Don't retry on 4xx client errors — only on network/5xx errors
        if (axios.isAxiosError(error) && error.response?.status) {
          const statusNum = error.response.status;
          if (statusNum >= 400 && statusNum < 500) {
            throw this.mapHcmError(error, operationName);
          }
        }

        if (attempt <= this.maxRetries) {
          const delay = attempt * 200; // 200ms, 400ms backoff
          this.logger.warn(
            `HCM ${operationName} failed (attempt ${attempt}), retrying in ${delay}ms...`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw this.mapHcmError(lastError, operationName);
  }

  /**
   * Converts a raw HCM/Axios error into a descriptive NestJS exception.
   */
  private mapHcmError(error: unknown, operationName: string): Error {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const data = error.response.data as any;
      
      // Extract the most descriptive message available from HCM response
      const hcmMessage = data?.message || data?.error || error.message;
      const fullMessage = `${hcmMessage}`;

      if (status === 404) {
        return new NotFoundException(fullMessage);
      }
      if (status >= 400 && status < 500) {
        return new BadRequestException(fullMessage);
      }
      return new InternalServerErrorException(`HCM ${operationName} failed: ${fullMessage}`);
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return new InternalServerErrorException(`HCM ${operationName} failed: ${message}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}
