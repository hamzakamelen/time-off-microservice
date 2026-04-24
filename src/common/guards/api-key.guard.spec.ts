import { ApiKeyGuard } from './api-key.guard.js';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockConfigService: jest.Mocked<ConfigService>;
  
  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockReturnValue('secret-key'),
    } as any;
    guard = new ApiKeyGuard(mockConfigService);
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  function createMockContext(url: string, apiKey?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          url,
          headers: apiKey ? { 'x-api-key': apiKey } : {},
        }),
      }),
    } as any;
  }

  it('should allow Swagger docs paths without API key', () => {
    const context = createMockContext('/api/docs');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException if no API key is provided', () => {
    const context = createMockContext('/time-off');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Missing x-api-key header');
  });

  it('should throw UnauthorizedException if API key is invalid', () => {
    const context = createMockContext('/time-off', 'wrong-key');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid API key');
  });

  it('should allow access if correct API key is provided', () => {
    const context = createMockContext('/time-off', 'secret-key');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should bypass guard in test environment', () => {
    process.env.NODE_ENV = 'test';
    const context = createMockContext('/time-off'); // No key, but in test env
    expect(guard.canActivate(context)).toBe(true);
  });
});
