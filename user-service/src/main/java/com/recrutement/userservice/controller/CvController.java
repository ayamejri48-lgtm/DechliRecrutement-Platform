
package com.recrutement.userservice.controller;

import com.recrutement.userservice.entity.Cv;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.service.CvService;
import com.recrutement.userservice.service.UserService;

import lombok.RequiredArgsConstructor;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import com.recrutement.userservice.dto.CvResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.io.IOException;
import java.util.List;

@RestController
@RequestMapping("/users/me/cvs")
@RequiredArgsConstructor
public class CvController {

    private final CvService cvService;
    private final UserService userService;


    @PostMapping(consumes = "multipart/form-data")
    @ResponseStatus(HttpStatus.CREATED)
    public CvResponse upload(
            @RequestParam("file") MultipartFile file,
            Authentication authentication
    ) throws IOException {

        User user = getCandidate(authentication);

        return CvResponse.from(
                cvService.upload(user.getId(), file)
        );
    }

    @PutMapping("/{cvId}/activate")
    public CvResponse activate(
            @PathVariable Long cvId,
            Authentication authentication
    ) {
        User user = getCandidate(authentication);

        return CvResponse.from(
                cvService.activate(user.getId(), cvId)
        );
    }

    private User getCandidate(Authentication authentication) {

        User user = userService.getUserByEmail(
                authentication.getName()
        );

        if (!Boolean.TRUE.equals(user.getEnabled())
                || user.getRole() == null
                || !user.getRole().name().equals("CANDIDATE")) {

            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Accès réservé aux candidats actifs"
            );
        }

        return user;
    }

    @GetMapping
    public List<CvResponse> getMyCvs(Authentication authentication) {

        User user = getCandidate(authentication);

        return cvService.getVisibleCvs(user.getId())
                .stream()
                .map(CvResponse::from)
                .toList();
    }



    @GetMapping("/{cvId}/download")
    public ResponseEntity<byte[]> download(
            @PathVariable Long cvId,
            Authentication authentication
    ) {
        User user = getCandidate(authentication);

        byte[] pdf = cvService.download(user.getId(), cvId);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"cv.pdf\""
                )
                .body(pdf);
    }

}
