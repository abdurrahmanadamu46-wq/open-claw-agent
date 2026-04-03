import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

export interface EdgeTerminalSessionRecord {
  sessionId: string;
  nodeId: string;
  tenantId: string;
  socket: Socket;
  createdAt: string;
}

@Injectable()
export class TerminalSessionRegistry {
  private readonly sessions = new Map<string, EdgeTerminalSessionRecord>();
  private readonly socketIndex = new Map<string, Set<string>>();

  register(session: EdgeTerminalSessionRecord): void {
    const previous = this.sessions.get(session.sessionId);
    if (previous) {
      this.remove(session.sessionId);
    }
    this.sessions.set(session.sessionId, session);
    const socketSessions = this.socketIndex.get(session.socket.id) ?? new Set<string>();
    socketSessions.add(session.sessionId);
    this.socketIndex.set(session.socket.id, socketSessions);
  }

  get(sessionId: string): EdgeTerminalSessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): EdgeTerminalSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    this.sessions.delete(sessionId);
    const socketSessions = this.socketIndex.get(session.socket.id);
    if (socketSessions) {
      socketSessions.delete(sessionId);
      if (socketSessions.size === 0) {
        this.socketIndex.delete(session.socket.id);
      }
    }
    return session;
  }

  removeBySocketId(socketId: string): EdgeTerminalSessionRecord[] {
    const sessionIds = Array.from(this.socketIndex.get(socketId) ?? []);
    const removed: EdgeTerminalSessionRecord[] = [];
    for (const sessionId of sessionIds) {
      const session = this.remove(sessionId);
      if (session) {
        removed.push(session);
      }
    }
    return removed;
  }

  emit(sessionId: string, eventName: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit(eventName, payload);
    }
  }

  emitReady(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_terminal_ready', payload);
    }
  }

  emitOutput(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_terminal_output', payload);
    }
  }

  emitError(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_terminal_error', payload);
    }
  }

  emitClosed(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_terminal_closed', payload);
    }
  }

  emitSchedulerStatus(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_scheduler_status', payload);
    }
  }

  emitSchedulerToggle(sessionId: string, payload: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socket.emit('edge_scheduler_toggle', payload);
    }
  }
}
