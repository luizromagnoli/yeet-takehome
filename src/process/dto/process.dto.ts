import { Type } from 'class-transformer';
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

  @IsUUID()
  action_id!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsUUID()
  original_action_id?: string;
}

export class ProcessRequestDto {
  @IsString()
  user_id!: string;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsString()
  game?: string;

  @IsOptional()
  @IsString()
  game_id?: string;

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
