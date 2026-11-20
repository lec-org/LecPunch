import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator';

export class WifiScanSampleDto {
  @IsString()
  @MaxLength(32)
  bssid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  ssid?: string;

  @IsOptional()
  @IsNumber()
  @Min(-120)
  @Max(0)
  rssi?: number;
}

export class WifiAnchorInputDto {
  @IsString()
  @MaxLength(32)
  bssid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  ssid?: string;

  @IsOptional()
  @IsNumber()
  @Min(-120)
  @Max(0)
  sampleRssi?: number;
}

export class CheckNetworkStatusDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WifiScanSampleDto)
  wifiScan?: WifiScanSampleDto[];
}

export class UpdateWifiFingerprintDto {
  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WifiAnchorInputDto)
  anchors!: WifiAnchorInputDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  minMatchCount?: number;

  @IsOptional()
  @IsInt()
  @Min(-100)
  @Max(-30)
  minRssi?: number;

  /** true 时与已有白名单 BSSID 合并追加（便于在工作室多点位采样），false 时覆盖保存。 */
  @IsOptional()
  @IsBoolean()
  merge?: boolean;
}
