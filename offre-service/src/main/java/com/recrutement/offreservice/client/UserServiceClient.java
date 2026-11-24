package com.recrutement.offreservice.client;

import com.recrutement.offreservice.dto.CvResponse;
import com.recrutement.offreservice.dto.InternalCandidateProfileDto;
import com.recrutement.offreservice.dto.InternalCvMetadataDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;

import java.util.List;

@FeignClient(name = "user-service")
public interface UserServiceClient {

    @GetMapping("/users/me/cvs")
    List<CvResponse> getMyCvs(
            @RequestHeader("Authorization") String authorization
    );

    @GetMapping("/internal/candidates/{candidateId}/profile")
    InternalCandidateProfileDto getCandidateProfile(
            @PathVariable("candidateId") Long candidateId,
            @RequestHeader("Authorization") String authorization
    );

    @GetMapping("/internal/candidates/{candidateId}/cvs/{cvId}/metadata")
    InternalCvMetadataDto getCvMetadata(
            @PathVariable("candidateId") Long candidateId,
            @PathVariable("cvId") Long cvId,
            @RequestHeader("Authorization") String authorization
    );

    @GetMapping("/internal/candidates/{candidateId}/cvs/{cvId}")
    byte[] downloadApplicationCv(
            @PathVariable("candidateId") Long candidateId,
            @PathVariable("cvId") Long cvId,
            @RequestHeader("Authorization") String authorization
    );
}
