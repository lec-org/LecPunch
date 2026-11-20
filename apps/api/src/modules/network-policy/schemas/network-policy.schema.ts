import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export interface WifiAnchorEntry {
  bssid: string;
  ssid?: string;
  sampleRssi?: number;
}

@Schema({ timestamps: true, collection: 'network_policies' })
export class NetworkPolicy {
  @Prop({ required: true, type: String, index: true })
  teamId!: string;

  @Prop({ required: true, type: Boolean, default: true })
  allowAnyNetwork!: boolean;

  @Prop({ type: [String], default: [] })
  allowedPublicIps!: string[];

  @Prop({ type: [String], default: [] })
  allowedCidrs!: string[];

  @Prop({ required: true, type: Boolean, default: false })
  trustProxy!: boolean;

  @Prop({ required: true, type: Number, default: 1, min: 1 })
  trustedProxyHops!: number;

  @Prop({ required: true, type: Boolean, default: false })
  wifiFingerprintEnabled!: boolean;

  @Prop({
    type: [
      {
        bssid: { type: String, required: true },
        ssid: { type: String, required: false },
        sampleRssi: { type: Number, required: false }
      }
    ],
    default: []
  })
  wifiAnchors!: WifiAnchorEntry[];

  @Prop({ required: true, type: Number, default: 2, min: 1 })
  wifiMinMatchCount!: number;

  @Prop({ required: true, type: Number, default: -82 })
  wifiMinRssi!: number;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export type NetworkPolicyDocument = HydratedDocument<NetworkPolicy>;
export const NetworkPolicySchema = SchemaFactory.createForClass(NetworkPolicy);

NetworkPolicySchema.index({ teamId: 1 }, { unique: true });
