package com.recrutement.offreservice.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "ai.service")
public class AiServiceProperties {

    /** Base URL of FastAPI AI-Service (not exposed via Gateway). */
    private String baseUrl = "http://localhost:8000";

    /** Shared secret for X-Internal-Api-Key (≥16 chars when enforced by AI). */
    private String apiKey = "";

    private int connectTimeoutMs = 5000;

    private int readTimeoutMs = 60000;
}
