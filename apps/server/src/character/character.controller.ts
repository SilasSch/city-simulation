import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { CharacterDto } from '@city/shared-types';
import {
  characterIdParamSchema,
  createCharacterRequestSchema,
} from '@city/game-protocol';
import { CurrentPrincipal } from '../auth/authenticated-principal';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ApplicationError } from '../shared/application-error';
import { CharacterService } from './character.service';

/**
 * REST-Transport für den Character-Vertical-Slice. Alle Endpunkte sind
 * geschützt; die Besitzeridentität kommt ausschließlich aus der Session.
 */
@Controller('characters')
@UseGuards(SessionAuthGuard)
export class CharacterController {
  constructor(private readonly characters: CharacterService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto> {
    const data = createCharacterRequestSchema.safeParse(body);
    if (!data.success) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        400,
        'Invalid character data',
      );
    }
    return this.characters.createCharacter(principal, data.data.name);
  }

  @Get()
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto[]> {
    return this.characters.listCharacters(principal);
  }

  @Get('selected')
  getSelected(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto> {
    return this.characters.getSelectedCharacter(principal);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const parsedId = characterIdParamSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        400,
        'Invalid character id',
      );
    }
    await this.characters.deleteCharacter(principal, parsedId.data);
  }

  @Post(':id/select')
  @HttpCode(HttpStatus.OK)
  async select(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto> {
    const parsedId = characterIdParamSchema.safeParse(id);
    if (!parsedId.success) {
      throw new ApplicationError(
        'VALIDATION_ERROR',
        400,
        'Invalid character id',
      );
    }
    return this.characters.selectCharacter(principal, parsedId.data);
  }
}
