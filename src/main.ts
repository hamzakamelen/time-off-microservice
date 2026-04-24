import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Security headers
  app.use(helmet());

  // Global validation pipe: automatically validates all incoming DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip properties not in the DTO
      forbidNonWhitelisted: true, // Throw error if unknown properties are sent
      transform: true,       // Auto-transform payloads to DTO instances
    }),
  );

  // Global exception filter: consistent error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global logging interceptor: logs every request
  app.useGlobalInterceptors(new LoggingInterceptor());

  // OpenAPI / Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('ExampleHR Time-Off Microservice')
    .setDescription('API for managing employee leave balances and time-off requests.')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env['PORT'] || 3000;
  await app.listen(port);
  logger.log(`🚀 Time-Off Service running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
