import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { participantCodeSchema, teachingStudyPlanSchema, studyAssignmentSchema, studyTicketSchema, type StudyTicket } from "./teaching-study-contracts.js";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const registrySchema = z.object({ version: z.literal(1), createdAt: z.string().datetime(), plan: teachingStudyPlanSchema, planHash: z.string(), assignments: z.array(studyAssignmentSchema).min(2).max(1000), registryHash: z.string() }).strict();
type Registry = z.infer<typeof registrySchema>;
function registryBody(value: Registry) { return { version: value.version, createdAt: value.createdAt, plan: value.plan, planHash: value.planHash, assignments: value.assignments }; }
export function validateRegistry(raw: unknown): Registry {
  const value = registrySchema.parse(raw);
  if (hash(value.plan) !== value.planHash || hash(registryBody(value)) !== value.registryHash || value.assignments.length !== value.plan.plannedParticipants || new Set(value.assignments.map(a => a.participantCode)).size !== value.assignments.length || new Set(value.assignments.map(a => a.trialId)).size !== value.assignments.length || value.assignments.some(a => a.assignedAt !== value.createdAt)) throw new Error("study_registry_invalid");
  return value;
}
/** A closed consented roster, allocated once before any teaching. Coordinator file is private. */
export function createTeachingStudy(raw: unknown, roster: unknown, now = new Date().toISOString()): Registry {
  const plan = teachingStudyPlanSchema.parse(raw), participants = z.array(participantCodeSchema).length(plan.plannedParticipants).parse(roster);
  z.string().datetime().parse(now);
  if (new Set(participants).size !== participants.length) throw new Error("study_duplicate_participant");
  const body = { version: 1 as const, createdAt: now, plan, planHash: hash(plan), assignments: participants.map(participantCode => ({ participantCode, trialId: randomUUID(), mode: randomInt(2) === 0 ? "zhixing" as const : "direct" as const, assignedAt: now })) };
  return { ...body, registryHash: hash(body) };
}
function ticketBody(ticket: StudyTicket) { return { version: ticket.version, plan: ticket.plan, planHash: ticket.planHash, registryHash: ticket.registryHash, assignment: ticket.assignment }; }
export function studyTicket(raw: unknown, code: string): StudyTicket {
  const registry = validateRegistry(raw), assignment = registry.assignments.find(a => a.participantCode === participantCodeSchema.parse(code));
  if (!assignment) throw new Error("study_participant_not_found");
  const body = { version: 1 as const, plan: registry.plan, planHash: registry.planHash, registryHash: registry.registryHash, assignment };
  return { ...body, ticketHash: hash(body) };
}
export function validateStudyTicket(raw: unknown): StudyTicket {
  const ticket = studyTicketSchema.parse(raw);
  if (hash(ticket.plan) !== ticket.planHash || hash(ticketBody(ticket)) !== ticket.ticketHash) throw new Error("study_ticket_invalid");
  return ticket;
}
