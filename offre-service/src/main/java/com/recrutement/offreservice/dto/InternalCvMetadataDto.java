package com.recrutement.offreservice.dto;

import lombok.Data;

@Data
public class InternalCvMetadataDto {

    private Long id;
    private String fileName;
    private String contentType;
    private Long fileSize;
    private Integer version;
    private Boolean active;
    private Boolean visible;
}
