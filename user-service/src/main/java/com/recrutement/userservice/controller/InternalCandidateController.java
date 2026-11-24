package com.recrutement.userservice.controller;

import com.recrutement.userservice.dto.InternalCandidateProfileResponse;
import com.recrutement.userservice.dto.InternalCvMetadataResponse;
import com.recrutement.userservice.entity.Cv;
import com.recrutement.userservice.service.InternalCandidateService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * API interservices uniquement (JWT SERVICE). Non exposée via la Gateway.
 */
@RestController
@RequestMapping("/internal/candidates")
@RequiredArgsConstructor
public class InternalCandidateController {

    private final InternalCandidateService internalCandidateService;

    @GetMapping("/{candidateId}/profile")
    public InternalCandidateProfileResponse profile(@PathVariable Long candidateId) {
        return internalCandidateService.getProfile(candidateId);
    }

    @GetMapping("/{candidateId}/cvs/{cvId}/metadata")
    public InternalCvMetadataResponse cvMetadata(
            @PathVariable Long candidateId,
            @PathVariable Long cvId) {
        return internalCandidateService.getCvMetadata(candidateId, cvId);
    }

    @GetMapping("/{candidateId}/cvs/{cvId}")
    public ResponseEntity<byte[]> downloadCv(
            @PathVariable Long candidateId,
            @PathVariable Long cvId) {

        Cv cv = internalCandidateService.requireCvEntity(candidateId, cvId);
        byte[] pdf = internalCandidateService.downloadCvForApplication(candidateId, cvId);

        String fileName = cv.getFileName() != null ? cv.getFileName() : "cv.pdf";
        MediaType contentType = MediaType.APPLICATION_PDF;
        if (cv.getContentType() != null && !cv.getContentType().isBlank()) {
            try {
                contentType = MediaType.parseMediaType(cv.getContentType());
            } catch (Exception ignored) {
                contentType = MediaType.APPLICATION_PDF;
            }
        }

        return ResponseEntity.ok()
                .contentType(contentType)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + fileName.replace("\"", "") + "\""
                )
                .body(pdf);
    }
}
