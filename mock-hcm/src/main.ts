import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('MockHCM');

  const port = process.env['MOCK_HCM_PORT'] || 3001;
  await app.listen(port);
  logger.log(`🏥 Mock HCM Server running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start Mock HCM:', err);
  process.exit(1);
});
