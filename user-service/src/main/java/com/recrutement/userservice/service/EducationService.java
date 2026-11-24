
package com.recrutement.userservice.service;

import com.recrutement.userservice.dto.EducationRequest;
import com.recrutement.userservice.dto.EducationResponse;
import com.recrutement.userservice.entity.Education;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.repository.EducationRepository;
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
public class EducationService {

    private final EducationRepository educationRepository;
    private final UserRepository userRepository;

    // CREATE
    @Transactional
    public EducationResponse ajouter(Long userId, EducationRequest request) {

        User user = verifierCandidat(userId);
        validerDates(request);

        Education education = new Education();
        education.setUser(user);
        appliquerModifications(education, request);

        return toResponse(educationRepository.save(education));
    }

    // READ ALL
    @Transactional(readOnly = true)
    public List<EducationResponse> consulter(Long userId) {

        verifierCandidat(userId);

        return educationRepository.findByUserId(userId)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    // READ BY ID
    @Transactional(readOnly = true)
    public EducationResponse consulterParId(
            Long userId, Long educationId) {

        verifierCandidat(userId);

        return toResponse(trouverEducation(userId, educationId));
    }

    // UPDATE
    @Transactional
    public EducationResponse modifier(
            Long userId,
            Long educationId,
            EducationRequest request) {

        verifierCandidat(userId);
        validerDates(request);

        Education education = trouverEducation(userId, educationId);
        appliquerModifications(education, request);

        return toResponse(educationRepository.save(education));
    }

    // DELETE
    @Transactional
    public void supprimer(Long userId, Long educationId) {

        verifierCandidat(userId);

        Education education = trouverEducation(userId, educationId);
        educationRepository.delete(education);
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
    private Education trouverEducation(Long userId, Long educationId) {

        return educationRepository
                .findByIdAndUserId(educationId, userId)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Formation introuvable"));
    }

    // Validation des dates
    private void validerDates(EducationRequest request) {

        if (request.getStartDate() == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "La date de début est obligatoire");
        }

        if (request.getEndDate() != null
                && request.getEndDate().isBefore(request.getStartDate())) {

            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "La date de fin doit être après la date de début");
        }
    }

    // Mapping Request vers Entity
    private void appliquerModifications(
            Education education,
            EducationRequest request) {

        education.setInstitution(request.getInstitution().trim());
        education.setDegree(request.getDegree().trim());
        education.setFieldOfStudy(request.getFieldOfStudy().trim());
        education.setStartDate(request.getStartDate());
        education.setEndDate(request.getEndDate());
    }

    // Mapping Entity vers Response
    private EducationResponse toResponse(Education education) {

        EducationResponse response = new EducationResponse();

        response.setId(education.getId());
        response.setInstitution(education.getInstitution());
        response.setDegree(education.getDegree());
        response.setFieldOfStudy(education.getFieldOfStudy());
        response.setStartDate(education.getStartDate());
        response.setEndDate(education.getEndDate());

        return response;
    }
}
