package com.recrutement.offreservice.client;

import com.recrutement.offreservice.config.AiServiceProperties;
import com.recrutement.offreservice.dto.ai.AiExtractResponse;
import com.recrutement.offreservice.dto.ai.AiMatchRequest;
import com.recrutement.offreservice.dto.ai.AiMatchResponse;
import com.recrutement.offreservice.exception.AiServiceException;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
@RequiredArgsConstructor
public class AiServiceClient {

    private final RestClient aiRestClient;
    private final AiServiceProperties properties;

    public AiExtractResponse extractCvPdf(byte[] pdfBytes, String fileName) {
        if (pdfBytes == null || pdfBytes.length == 0) {
            throw new AiServiceException(
                    "PDF CV vide ou indisponible",
                    "EMPTY_PDF",
                    HttpStatus.UNPROCESSABLE_ENTITY
            );
        }

        String safeName = StringUtils.hasText(fileName) ? fileName : "cv.pdf";
        if (!safeName.toLowerCase().endsWith(".pdf")) {
            safeName = safeName + ".pdf";
        }

        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        String finalName = safeName;
        builder.part("file", new ByteArrayResource(pdfBytes) {
            @Override
            public String getFilename() {
                return finalName;
            }
        }).filename(finalName).contentType(MediaType.APPLICATION_PDF);

        try {
            return aiRestClient.post()
                    .uri("/api/v1/extract/cv/pdf")
                    .headers(this::applyAuth)
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(builder.build())
                    .retrieve()
                    .body(AiExtractResponse.class);
        } catch (RestClientResponseException ex) {
            throw mapResponse(ex, "AI extract CV PDF failed");
        } catch (RestClientException ex) {
            throw new AiServiceException(
                    "AI-Service injoignable ou timeout (extract)",
                    "AI_TIMEOUT",
                    HttpStatus.SERVICE_UNAVAILABLE
            );
        }
    }

    public AiMatchResponse match(AiMatchRequest request) {
        try {
            return aiRestClient.post()
                    .uri("/api/v1/match")
                    .headers(this::applyAuth)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AiMatchResponse.class);
        } catch (RestClientResponseException ex) {
            throw mapResponse(ex, "AI match failed");
        } catch (RestClientException ex) {
            throw new AiServiceException(
                    "AI-Service injoignable ou timeout (match)",
                    "AI_TIMEOUT",
                    HttpStatus.SERVICE_UNAVAILABLE
            );
        }
    }

    private void applyAuth(org.springframework.http.HttpHeaders headers) {
        if (StringUtils.hasText(properties.getApiKey())) {
            headers.set("X-Internal-Api-Key", properties.getApiKey());
        }
        headers.set("X-Request-Id", java.util.UUID.randomUUID().toString());
    }

    private AiServiceException mapResponse(RestClientResponseException ex, String fallback) {
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        if (status == null) {
            status = HttpStatus.SERVICE_UNAVAILABLE;
        }
        String code = switch (status.value()) {
            case 401 -> "AI_UNAUTHORIZED";
            case 413 -> "AI_PAYLOAD_TOO_LARGE";
            case 422 -> "AI_UNPROCESSABLE";
            case 503 -> "AI_UNAVAILABLE";
            default -> "AI_ERROR";
        };
        String message = humanizeAiBody(ex.getResponseBodyAsString(), fallback, status);
        if (message.length() > 500) {
            message = message.substring(0, 500);
        }
        return new AiServiceException(message, code, status);
    }

    private static String humanizeAiBody(String body, String fallback, HttpStatus status) {
        if (!StringUtils.hasText(body)) {
            return status == HttpStatus.UNAUTHORIZED
                    ? "Clé API interne AI-Service invalide ou manquante"
                    : fallback;
        }
        String trimmed = body.trim();
        // FastAPI: {"detail":"..."} or {"detail":[{msg:...}]}
        if (trimmed.startsWith("{") && trimmed.contains("\"detail\"")) {
            int key = trimmed.indexOf("\"detail\"");
            int colon = trimmed.indexOf(':', key);
            if (colon > 0) {
                String rest = trimmed.substring(colon + 1).trim();
                if (rest.startsWith("\"")) {
                    int end = rest.indexOf('"', 1);
                    if (end > 1) {
                        return rest.substring(1, end);
                    }
                }
            }
        }
        if (status == HttpStatus.UNAUTHORIZED) {
            return "Clé API interne AI-Service invalide ou manquante";
        }
        return trimmed;
    }
}
