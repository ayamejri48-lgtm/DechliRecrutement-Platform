package com.recrutement.userservice.dto;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@Builder
public class InternalCvMetadataResponse {

    private Long id;
    private String fileName;
    private String contentType;
    private Long fileSize;
    private Integer version;
    private Boolean active;
    private Boolean visible;
    private LocalDateTime createdAt;
}
