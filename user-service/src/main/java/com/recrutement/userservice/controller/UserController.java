package com.recrutement.userservice.controller;

import com.recrutement.userservice.dto.CandidateResponse;
import com.recrutement.userservice.dto.UserBootstrapRequest;
import com.recrutement.userservice.dto.UserUpdateRequest;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;


    @GetMapping("/me")
    public User getCurrentUser(Authentication authentication) {

        return userService.getUserByEmail(authentication.getName());
    }

    @GetMapping("/{id}")
    public User getUserById(
            @PathVariable Long id,
            Authentication authentication
    ) {
        boolean isAdmin = authentication.getAuthorities()
                .stream()
                .anyMatch(authority ->
                        authority.getAuthority().equals("ROLE_ADMIN"));

        if (!isAdmin) {
            User currentUser =
                    userService.getUserByEmail(authentication.getName());

            if (!currentUser.getId().equals(id)) {
                throw new ResponseStatusException(
                        HttpStatus.FORBIDDEN,
                        "You are not allowed to access this user's profile"
                );
            }
        }

        return userService.getUserById(id);
    }
    @GetMapping
    public List<User> getAllUsers() {

        return userService.getAllUsers();
    }

    /**
     * Crée le profil user_db à partir du compte Auth (ADMIN).
     * Filet de sécurité quand l’événement Kafka n’est pas encore arrivé.
     */
    @PostMapping("/bootstrap")
    @ResponseStatus(HttpStatus.CREATED)
    public User bootstrapProfile(
            @Valid @RequestBody UserBootstrapRequest request,
            Authentication authentication
    ) {
        boolean isAdmin = authentication.getAuthorities()
                .stream()
                .anyMatch(authority ->
                        authority.getAuthority().equals("ROLE_ADMIN"));
        if (!isAdmin) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Seul un administrateur peut initialiser un profil"
            );
        }
        return userService.bootstrapFromAuth(request);
    }

    @PutMapping("/{id}")

    public User updateUser(
            @PathVariable Long id,
            @Valid @RequestBody UserUpdateRequest request,
            Authentication authentication
    ) {
        boolean isAdmin = authentication.getAuthorities()
                .stream()
                .anyMatch(authority ->
                        authority.getAuthority().equals("ROLE_ADMIN"));

        if (!isAdmin) {
            User currentUser =
                    userService.getUserByEmail(authentication.getName());

            if (!currentUser.getId().equals(id)) {
                throw new ResponseStatusException(
                        HttpStatus.FORBIDDEN,
                        "You are not allowed to update this user's profile"
                );
            }
        }

        return userService.updateUser(id, request);
    }


    @GetMapping("/candidates")
    public List<CandidateResponse> getCandidates() {
        return userService.getCandidates();
    }


    @PostMapping(
            value = "/me/photo",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    public User uploadProfilePhoto(
            Authentication authentication,
            @RequestPart("file") MultipartFile file
    ) {
        User currentUser = userService.getUserByEmail(
                authentication.getName()
        );

        if (!canManageOwnProfilePhoto(currentUser.getRole())) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Only candidates, recruiters and admins can upload a profile photo"
            );
        }

        return userService.uploadProfilePhoto(
                authentication.getName(),
                file
        );
    }


    @GetMapping("/me/photo")
    public ResponseEntity<byte[]> downloadProfilePhoto(
            Authentication authentication) {

        User user = userService.getUserByEmail(authentication.getName());

        if (!canManageOwnProfilePhoto(user.getRole())) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "Only candidates, recruiters and admins can access their profile photo"
            );
        }

        byte[] photo = userService.downloadProfilePhoto(authentication.getName());

        String photoKey = user.getProfilePicture();
        MediaType contentType = MediaType.IMAGE_JPEG;

        if (photoKey != null && photoKey.endsWith(".png")) {
            contentType = MediaType.IMAGE_PNG;
        } else if (photoKey != null && photoKey.endsWith(".webp")) {
            contentType = MediaType.parseMediaType("image/webp");
        }

        return ResponseEntity.ok()
                .contentType(contentType)
                .body(photo);
    }

    /** Profil présent dans user-service mais absent de l'authentification. */
    @PatchMapping("/{id}/presence")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setPresence(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        Boolean enabled = body == null ? null : body.get("enabled");
        if (enabled == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "enabled requis");
        }
        userService.setEnabled(id, enabled);
    }

    @DeleteMapping("/{id}/profile")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProfile(@PathVariable Long id) {
        userService.deleteProfile(id);
    }

    /** Photo de profil : propriétaire JWT (candidat, recruteur ou admin). */
    private static boolean canManageOwnProfilePhoto(Role role) {
        return role == Role.CANDIDATE
                || role == Role.RECRUITER
                || role == Role.ADMIN;
    }

}

