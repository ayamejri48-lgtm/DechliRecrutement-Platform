package com.recrutement.userservice.service;

import com.recrutement.userservice.dto.UserRequest;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.exception.UserNotFoundException;
import com.recrutement.userservice.repository.CandidateSkillRepository;
import com.recrutement.userservice.repository.CvRepository;
import com.recrutement.userservice.repository.EducationRepository;
import com.recrutement.userservice.repository.ExperienceRepository;
import com.recrutement.userservice.repository.NotificationRepository;
import com.recrutement.userservice.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import com.recrutement.userservice.dto.UserUpdateRequest;
import com.recrutement.userservice.event.UserRegisteredEvent;
import java.util.List;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.dto.CandidateResponse;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final ProfilePhotoStorageService profilePhotoStorageService;
    private final CandidateSkillRepository candidateSkillRepository;
    private final ExperienceRepository experienceRepository;
    private final EducationRepository educationRepository;
    private final CvRepository cvRepository;
    private final NotificationRepository notificationRepository;

    // GET /users/{id}
    public User getUserById(Long id) {
        return userRepository.findById(id)
                .orElseThrow(() ->
                        new UserNotFoundException("User not found with id: " + id));
    }

    public User getUserByEmail(String email) {

        return userRepository.findByEmail(email)
                .orElseThrow(() ->
                        new UserNotFoundException("User not found with email: " + email));
    }

    // GET /users
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }



    // PUT /users/{id}
    public User updateUser(Long id, UserUpdateRequest request) {

        User user = userRepository.findById(id)
                .orElseThrow(() ->
                        new UserNotFoundException("User not found with id: " + id));

        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setPhone(request.getPhone());
        // La photo est gérée exclusivement par l'endpoint d'upload.
        if (request.getDescription() != null) {
            user.setDescription(request.getDescription());
        }

        return userRepository.save(user);
    }


    public User createUserFromEvent(UserRegisteredEvent event) {

        // 1. Événement déjà traité ?
        if (userRepository.existsById(event.getUserId())) {
            return userRepository.findById(event.getUserId()).orElseThrow();
        }

        // 2. Créer le profil utilisateur avec le même ID que Auth-Service
        User user = new User();

        user.setId(event.getUserId());
        user.setFirstName(event.getFirstName());
        user.setLastName(event.getLastName());
        user.setEmail(event.getEmail());
        user.setRole(Role.valueOf(event.getRole()));
        user.setEnabled(true);
        return userRepository.save(user);
    }

    /**
     * Garantit le profil user_db après création Auth (filet si Kafka est lent / down).
     * Idempotent sur l’id Auth.
     */
    @Transactional
    public User bootstrapFromAuth(com.recrutement.userservice.dto.UserBootstrapRequest request) {
        if (userRepository.existsById(request.getId())) {
            return userRepository.findById(request.getId()).orElseThrow();
        }

        Role role;
        try {
            role = Role.valueOf(request.getRole().trim().toUpperCase());
        } catch (Exception ex) {
            throw new IllegalArgumentException("Rôle invalide : " + request.getRole());
        }

        User user = new User();
        user.setId(request.getId());
        user.setFirstName(request.getFirstName().trim());
        user.setLastName(request.getLastName().trim());
        user.setEmail(request.getEmail().trim().toLowerCase());
        user.setPhone(request.getPhone() != null ? request.getPhone().trim() : null);
        user.setRole(role);
        user.setEnabled(true);
        return userRepository.save(user);
    }


    public List<CandidateResponse> getCandidates() {

        return userRepository.findByRole(Role.CANDIDATE)
                .stream()
                .map(user -> new CandidateResponse(
                        user.getId(),
                        user.getFirstName(),
                        user.getLastName()
                ))
                .toList();
    }


    @Transactional
    public void deactivateUser(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("User not found"));

        user.setEnabled(false);

        userRepository.save(user);
    }

    @Transactional
    public void setEnabled(Long userId, boolean enabled) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Profil introuvable"));
        user.setEnabled(enabled);
        userRepository.save(user);
    }

    @Transactional
    public void deleteUserFromEvent(Long userId) {
        if (userRepository.existsById(userId)) {
            purgeProfile(userId);
        }
    }

    @Transactional
    public void deleteProfile(Long userId) {
        if (!userRepository.existsById(userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Profil introuvable");
        }
        purgeProfile(userId);
    }

    private void purgeProfile(Long userId) {
        candidateSkillRepository.deleteByUserId(userId);
        experienceRepository.deleteByUserId(userId);
        educationRepository.deleteByUserId(userId);
        cvRepository.deleteByUserId(userId);
        notificationRepository.deleteByRecipientId(userId);
        userRepository.deleteById(userId);
    }



    @Transactional
    public void reactivateUser(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() ->
                        new UserNotFoundException("User not found: " + userId));

        user.setEnabled(true);
        userRepository.save(user);
    }

    @Transactional
    public User uploadProfilePhoto(String email, MultipartFile file) {

        User user = getUserByEmail(email);

        // Enregistrer la nouvelle photo dans S3
        String newPhotoKey = profilePhotoStorageService.upload(
                user.getId(), file
        );

        String oldPhotoKey = user.getProfilePicture();

        try {
            user.setProfilePicture(newPhotoKey);
            User savedUser = userRepository.saveAndFlush(user);

            // L'ancienne photo sera nettoyée séparément
            // après confirmation de la transaction.
            return savedUser;

        } catch (RuntimeException e) {
            // Éviter de conserver un fichier inutilisé dans S3.
            try {
                profilePhotoStorageService.delete(newPhotoKey);
            } catch (RuntimeException ignored) {
                // Une procédure de nettoyage pourra traiter cet objet.
            }
            throw e;
        }
    }


    public byte[] downloadProfilePhoto(String email) {

        User user = getUserByEmail(email);

        String photoKey = user.getProfilePicture();

        if (photoKey == null || photoKey.isBlank()) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Aucune photo de profil"
            );
        }

        return profilePhotoStorageService.download(photoKey);
    }

}