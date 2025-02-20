import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { RedisService } from "../redis/redis.service";

/**
 * ValidatorGateway handles WebSocket connections for validators, manages peer discovery,
 * and facilitates real-time communication between validators.
 */
@WebSocketGateway({ transports: ["websocket"], cors: true })
export class ValidatorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger(ValidatorGateway.name);

  // Tracks connected validators using their socket ID as the key
  private connectedValidators: Map<string, Socket> = new Map();

  /**
   * Constructor initializes the gateway with the Redis service dependency.
   * @param redisService - Service for interacting with Redis to store validator peers.
   */
  constructor(private readonly redisService: RedisService) { }

  /**
   * Handles new WebSocket connections from validators.
   * Validates the connection token and role before accepting the connection.
   * @param client - The socket instance representing the connected validator.
   */
  async handleConnection(client: Socket) {
    const { token, role } = client.handshake.query;

    // Validate token and role
    if (!token || role !== "validator") {
      this.logger.warn(`Connection rejected: Invalid token or incorrect role`);
      client.disconnect();
      return;
    }

    // Add the validator to the connected list
    this.connectedValidators.set(client.id, client);
    this.logger.log(`New validator connected: ${client.id}`);

    // Store the validator's information in Redis
    await this.redisService.hSet("validatorPeers", client.id, client.handshake.address);

    // Notify all validators about the new peer
    this.server.emit("peerDiscovery", { newPeer: client.id });
  }

  /**
   * Handles disconnections of validators.
   * Removes the validator from the connected list and Redis, then notifies other validators.
   * @param client - The socket instance representing the disconnected validator.
   */
  async handleDisconnect(client: Socket) {
    this.connectedValidators.delete(client.id);
    this.logger.warn(`Validator disconnected: ${client.id}`);

    // Remove the validator from Redis
    await this.redisService.removeValidatorPeer(client.id);

    // Notify all validators about the disconnected peer
    this.server.emit("peerDiscovery", { disconnectedPeer: client.id });
  }

  /**
   * Handles heartbeat messages from validators to confirm their activity.
   * @param client - The socket instance representing the validator.
   */
  @SubscribeMessage("heartbeat")
  async handleHeartbeat(client: Socket) {
    this.logger.log(`Heartbeat received from: ${client.id}`);
  }

  /**
   * Handles state synchronization messages from validators.
   * Broadcasts the state sync data to all connected validators.
   * @param client - The socket instance representing the validator.
   * @param data - The state synchronization data.
   */
  @SubscribeMessage("STATE_SYNC")
  async handleStateSync(client: Socket, data: any) {
    this.logger.log(`State synchronization received from: ${client.id}`);
    this.server.emit("STATE_SYNC", data);
  }

  /**
   * Handles failover initiation messages from validators.
   * Broadcasts the failover event to all connected validators.
   * @param client - The socket instance representing the validator.
   */
  @SubscribeMessage("FAILOVER_INITIATED")
  async handleFailover(client: Socket) {
    this.logger.warn(`Failover initiated by: ${client.id}`);
    this.server.emit("FAILOVER_INITIATED");
  }
}