import { Expose, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export type ActionKind = 'bet' | 'win' | 'rollback';

export class ActionDto {
  @IsIn(['bet', 'win', 'rollback'])
  action!: ActionKind;

  @Expose({ name: 'action_id' })
  @IsUUID()
  actionId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @Expose({ name: 'original_action_id' })
  @IsOptional()
  @IsUUID()
  originalActionId?: string;
}

export class ProcessRequestDto {
  @Expose({ name: 'user_id' })
  @IsString()
  userId!: string;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsString()
  game?: string;

  @Expose({ name: 'game_id' })
  @IsOptional()
  @IsString()
  gameId?: string;

  @IsOptional()
  @IsBoolean()
  finished?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => ActionDto)
  actions?: ActionDto[];
}
