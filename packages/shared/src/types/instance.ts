export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
  /** Which LLM provider serves content creation (posts, blog slideshows, video angles). */
  contentLlmProvider: "ollama" | "claude";
  /** Optional model override for the selected provider; undefined = provider default. */
  contentLlmModel?: string;
}

export interface InstanceExperimentalSettings {
  enableIsolatedWorkspaces: boolean;
  autoRestartDevServerWhenIdle: boolean;
}

export interface InstanceSettings {
  id: string;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettings;
  createdAt: Date;
  updatedAt: Date;
}
