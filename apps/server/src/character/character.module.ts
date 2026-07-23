import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterController } from './character.controller';
import { CharacterRepository } from './character.repository';
import { CharacterService } from './character.service';

/**
 * Character-Fachmodul: erstellen, auflisten, auswählen, laden.
 * Bewusst klein gehalten — keine Welt, Position oder sonstigen
 * Zukunftskonzepte.
 */
@Module({
  imports: [AuthModule],
  controllers: [CharacterController],
  providers: [CharacterService, CharacterRepository],
})
export class CharacterModule {}
