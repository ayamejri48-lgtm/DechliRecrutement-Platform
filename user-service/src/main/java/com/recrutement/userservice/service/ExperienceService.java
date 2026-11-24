
package com.recrutement.userservice.service;

import com.recrutement.userservice.dto.ExperienceRequest;
import com.recrutement.userservice.dto.ExperienceResponse;
import com.recrutement.userservice.entity.Experience;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.repository.ExperienceRepository;
import com.recrutement.userservice.repository.UserRepository;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
@RequiredArgsConstructor
public class ExperienceService {

    private final ExperienceRepository experienceRepository;
    private final UserRepository userRepository;

    // CREATE
    @Transactional
    public ExperienceResponse ajouter(
            Long userId, ExperienceRequest request) {

        User user = verifierCandidat(userId);
        validerDates(request);

        Experience experience = new Experience();
        experience.setUser(user);
        appliquerModifications(experience, request);

        return toResponse(experienceRepository.save(experience));
    }

    // READ ALL
    @Transactional(readOnly = true)
    public List<ExperienceResponse> consulter(Long userId) {

        verifierCandidat(userId);

        return experienceRepository.findByUserId(userId)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    // READ BY ID
    @Transactional(readOnly = true)
    public ExperienceResponse consulterParId(
            Long userId, Long experienceId) {

        verifierCandidat(userId);

        return toResponse(
                trouverExperience(userId, experienceId));
    }

    // UPDATE
    @Transactional
    public ExperienceResponse modifier(
            Long userId,
            Long experienceId,
            ExperienceRequest request) {

        verifierCandidat(userId);
        validerDates(request);

        Experience experience =
                trouverExperience(userId, experienceId);

        appliquerModifications(experience, request);

        return toResponse(experienceRepository.save(experience));
    }

    // DELETE
    @Transactional
    public void supprimer(Long userId, Long experienceId) {

        verifierCandidat(userId);

        Experience experience =
                trouverExperience(userId, experienceId);

        experienceRepository.delete(experience);
    }

    // Vérification du candidat actif
    private User verifierCandidat(Long userId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new AccessDeniedException(
                        "Utilisateur non autorisé"));

        if (!Boolean.TRUE.equals(user.getEnabled())
                || user.getRole() != Role.CANDIDATE) {

            throw new AccessDeniedException(
                    "Accès réservé aux candidats actifs");
        }

        return user;
    }

    // Vérification de propriété
    private Experience trouverExperience(
            Long userId, Long experienceId) {

        return experienceRepository
                .findByIdAndUserId(experienceId, userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Expérience introuvable"));
    }

    // Validation métier
    private void validerDates(ExperienceRequest request) {

        if (request.getStartDate() == null) {
            throw new IllegalArgumentException(
                    "La date de début est obligatoire");
        }

        if (request.getEndDate() != null
                && request.getEndDate()
                .isBefore(request.getStartDate())) {

            throw new IllegalArgumentException(
                    "La date de fin doit être après la date de début");
        }
    }

    // Mapping Request vers Entity
    private void appliquerModifications(
            Experience experience,
            ExperienceRequest request) {

        experience.setJobTitle(request.getJobTitle().trim());
        experience.setCompany(request.getCompany().trim());
        experience.setStartDate(request.getStartDate());
        experience.setEndDate(request.getEndDate());
        experience.setDescription(request.getDescription());
    }

    // Mapping Entity vers Response
    private ExperienceResponse toResponse(Experience experience) {

        ExperienceResponse response = new ExperienceResponse();

        response.setId(experience.getId());
        response.setJobTitle(experience.getJobTitle());
        response.setCompany(experience.getCompany());
        response.setStartDate(experience.getStartDate());
        response.setEndDate(experience.getEndDate());
        response.setDescription(experience.getDescription());

        return response;
    }
}
