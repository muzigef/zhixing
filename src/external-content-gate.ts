export interface ExternalContentRequest {
  readonly providerId: string;
  readonly containsUserMaterials: boolean;
  readonly confirmed: boolean;
}

/** Enforces explicit consent before user materials can enter an external model request. */
export function assertExternalContentAllowed(request: ExternalContentRequest): void {
  if (request.containsUserMaterials && !request.confirmed) {
    throw new Error(`external_content_confirmation_required: ${request.providerId}`);
  }
}
